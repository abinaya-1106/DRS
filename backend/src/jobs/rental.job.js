import cron from "node-cron";
import pool from "../config/db.js";
import {
  DEPOSIT_TIMEOUT_SECONDS,
  RENT_INTERVAL_SECONDS,
  REVIEW_TIMEOUT_SECONDS,
  RENT_DUE_NOTIFICATION_SECONDS,
} from "../config/env.js";
import { notify, notifyMany } from "../services/notification.service.js";
import {
  closeAgreement,
  returnDepositOnChain,
} from "../services/blockchain.service.js";

let isLeaseDetectorRunning = false;
let isReviewFinalizerRunning = false;
let isDepositTimeoutJobRunning = false;
let isReviewTimeoutJobRunning = false;
let isRentPaymentNotificationRunning = false;

// Lease Expiry Detection Job - changes rental agreement status from 'ACTIVE' to 'LEASE_EXPIRED' and notifies both tenant and landlord
// TODO: increase to every 30 minutes or so in production, remove console logs, and add error handling
cron.schedule("0 * * * * *", async () => {
  if (isLeaseDetectorRunning) {
    return;
  }

  isLeaseDetectorRunning = true;
  try {
    const [expiredLeases] = await pool.query(
      `SELECT
          r.id AS rental_id,
          r.tenant_id,
          r.landlord_id
      FROM rental_agreements r
      WHERE r.status = 'ACTIVE' AND
          (r.start_date + INTERVAL (r.lease_duration * ?) SECOND) < NOW()`,
      [RENT_INTERVAL_SECONDS],
    );

    const expiredLeasesIds = expiredLeases.map((lease) => lease.rental_id);

    if (expiredLeasesIds.length > 0) {
      await pool.query(
        `UPDATE rental_agreements
          SET status = 'LEASE_EXPIRED'
          WHERE id IN (?)`,
        [expiredLeasesIds],
      );
      console.log(`Marked leases as expired: ${expiredLeasesIds.join(", ")}`);

      Promise.allSettled([
        notifyMany(
          pool,
          expiredLeases.map((lease) => ({
            userId: lease.tenant_id,
            entityType: "RENTAL",
            entityId: lease.rental_id,
            type: "RENTAL_LEASE_EXPIRED",
            message: `Your lease has expired.`,
          })),
        ),
        notifyMany(
          pool,
          expiredLeases.map((lease) => ({
            userId: lease.landlord_id,
            entityType: "RENTAL",
            entityId: lease.rental_id,
            type: "RENTAL_LEASE_EXPIRED",
            message: `Your tenant's lease has expired.`,
          })),
        ),
      ]).then((results) => {
        results.forEach((result, idx) => {
          if (result.status === "rejected") {
            const channel = idx === 0 ? "tenant" : "landlord";
            console.error(
              `[LEASE_DETECTOR] ${channel} notifications failed:`,
              result.reason,
            );
          }
        });
      });
    }
  } catch (err) {
    console.error("[LEASE_DETECTOR] Job failed:", err);
  } finally {
    isLeaseDetectorRunning = false;
  }
});

// Review Finalizer Job - finalizes rentals after both parties have reviewed and returns the deposit on-chain
cron.schedule("20 * * * * *", async () => {
  if (isReviewFinalizerRunning) {
    return;
  }

  isReviewFinalizerRunning = true;
  try {
    const [leasesToFinalize] = await pool.query(
      `SELECT
          r.id AS rental_id,
          r.tenant_id,
          r.landlord_id,
          r.property_id,
          ca.blockchain_index
      FROM rental_agreements r
      LEFT JOIN contract_agreements ca ON ca.rental_agreement_id = r.id
      WHERE r.status = 'REVIEW_COMPLETED'`,
    );

    for (const lease of leasesToFinalize) {
      const conn = await pool.getConnection();

      try {
        await conn.beginTransaction();

        await conn.query(
          `UPDATE rental_agreements
            SET status = 'COMPLETED'
            WHERE id = ? AND status = 'REVIEW_COMPLETED'`,
          [lease.rental_id],
        );

        if (
          lease.blockchain_index !== null &&
          lease.blockchain_index !== undefined
        ) {
          try {
            await returnDepositOnChain(Number(lease.blockchain_index));
            await closeAgreement(Number(lease.blockchain_index));
          } catch (chainErr) {
            console.error(
              `Failed to finalize agreement on chain for rental ${lease.rental_id}:`,
              chainErr,
            );
            await conn.rollback();
            continue;
          }
        }

        await conn.query(
          `UPDATE properties
            SET is_available = TRUE
            WHERE id = ?`,
          [lease.property_id],
        );

        await notify(conn, {
          userId: lease.tenant_id,
          entityType: "RENTAL",
          type: "RENTAL_COMPLETED",
          message: `Your lease has been completed and the deposit has been returned to your wallet.`,
          metadata: {
            rental_id: lease.rental_id,
          },
        });

        await notify(conn, {
          userId: lease.landlord_id,
          entityType: "RENTAL",
          type: "RENTAL_COMPLETED",
          message: `Your tenant's lease has been completed and the property is now available again. The tenant's deposit has been returned to their wallet.`,
          metadata: {
            rental_id: lease.rental_id,
          },
        });

        await conn.commit();
      } catch (leaseErr) {
        await conn.rollback();
        console.error(
          `[REVIEW_FINALIZER] Failed for rental ${lease.rental_id}:`,
          leaseErr,
        );
      } finally {
        conn.release();
      }
    }
  } catch (err) {
    console.error("[REVIEW_FINALIZER] Job failed:", err);
  } finally {
    isReviewFinalizerRunning = false;
  }
});

// Deposit Timeout Job - If deposit is not paid after signing the agreement, automatically cancels the agreement after sometime and notifies both tenant and landlord
cron.schedule("40 * * * * *", async () => {
  if (isDepositTimeoutJobRunning) {
    return;
  }

  isDepositTimeoutJobRunning = true;
  try {
    const [timedOutRentals] = await pool.query(
      `SELECT
          r.id AS rental_id,
          r.tenant_id,
          r.landlord_id,
          r.property_id
      FROM rental_agreements r
      WHERE r.status IN ('PENDING_DEPOSIT', 'APPROVED')
        AND TIMESTAMPDIFF(SECOND, COALESCE(r.updated_at, r.created_at), NOW()) >= ?`,
      [DEPOSIT_TIMEOUT_SECONDS],
    );

    if (timedOutRentals.length === 0) {
      return;
    }

    const finalizedTimeouts = [];

    for (const rental of timedOutRentals) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        const [rentalUpdate] = await conn.query(
          `UPDATE rental_agreements
            SET status = 'REJECTED'
            WHERE id = ? AND status IN ('PENDING_DEPOSIT', 'APPROVED')`,
          [rental.rental_id],
        );

        if (rentalUpdate.affectedRows === 0) {
          await conn.rollback();
          continue;
        }

        await conn.query(
          `UPDATE properties
            SET is_available = TRUE
            WHERE id = ?`,
          [rental.property_id],
        );

        await conn.commit();
        finalizedTimeouts.push(rental);
      } catch (rentalErr) {
        await conn.rollback();
        console.error(
          `[DEPOSIT_TIMEOUT] Failed for rental ${rental.rental_id}:`,
          rentalErr,
        );
      } finally {
        conn.release();
      }
    }

    if (finalizedTimeouts.length === 0) {
      return;
    }

    Promise.allSettled([
      notifyMany(
        pool,
        finalizedTimeouts.map((rental) => ({
          userId: rental.tenant_id,
          entityType: "RENTAL",
          entityId: rental.rental_id,
          type: "RENTAL_REJECTED",
          message:
            "Your rental was cancelled because the deposit was not paid before the deadline.",
        })),
      ),
      notifyMany(
        pool,
        finalizedTimeouts.map((rental) => ({
          userId: rental.landlord_id,
          entityType: "RENTAL",
          entityId: rental.rental_id,
          type: "RENTAL_REJECTED",
          message:
            "A rental was cancelled because the tenant did not pay the deposit before the deadline.",
        })),
      ),
    ]).then((results) => {
      results.forEach((result, idx) => {
        if (result.status === "rejected") {
          const channel = idx === 0 ? "tenant" : "landlord";
          console.error(
            `[DEPOSIT_TIMEOUT] ${channel} notifications failed:`,
            result.reason,
          );
        }
      });
    });
  } catch (err) {
    console.error("[DEPOSIT_TIMEOUT] Job failed:", err);
  } finally {
    isDepositTimeoutJobRunning = false;
  }
});

// Review Timeout Job - If one party doesn't rate after lease expires, auto-complete rental after 7 days
cron.schedule("30 * * * * *", async () => {
  if (isReviewTimeoutJobRunning) {
    return;
  }

  isReviewTimeoutJobRunning = true;
  try {
    const [timedOutReviews] = await pool.query(
      `SELECT
          r.id AS rental_id,
          r.tenant_id,
          r.landlord_id,
          r.property_id,
          ca.blockchain_index
      FROM rental_agreements r
      LEFT JOIN contract_agreements ca ON ca.rental_agreement_id = r.id
      WHERE r.status = 'LEASE_EXPIRED'
        AND TIMESTAMPDIFF(SECOND, COALESCE(r.updated_at, r.created_at), NOW()) >= ?`,
      [REVIEW_TIMEOUT_SECONDS],
    );

    if (timedOutReviews.length === 0) {
      isReviewTimeoutJobRunning = false;
      return;
    }

    const completedReviews = [];

    for (const rental of timedOutReviews) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        const [rentalUpdate] = await conn.query(
          `UPDATE rental_agreements
            SET status = 'COMPLETED'
            WHERE id = ? AND status = 'LEASE_EXPIRED'`,
          [rental.rental_id],
        );

        if (rentalUpdate.affectedRows === 0) {
          await conn.rollback();
          continue;
        }

        await conn.query(
          `UPDATE properties
            SET is_available = TRUE
            WHERE id = ?`,
          [rental.property_id],
        );

        // Finalize on-chain before committing the DB change so a failed chain call
        // keeps the rental eligible for retry.
        if (
          rental.blockchain_index !== null &&
          rental.blockchain_index !== undefined
        ) {
          try {
            await returnDepositOnChain(Number(rental.blockchain_index));
            await closeAgreement(Number(rental.blockchain_index));
          } catch (chainErr) {
            console.error(
              `Failed to finalize agreement on chain for rental ${rental.rental_id}:`,
              chainErr,
            );
            await conn.rollback();
            continue;
          }
        }

        await conn.commit();
        completedReviews.push(rental);
      } catch (reviewErr) {
        await conn.rollback();
        console.error(
          `[REVIEW_TIMEOUT] Failed for rental ${rental.rental_id}:`,
          reviewErr,
        );
      } finally {
        conn.release();
      }
    }

    if (completedReviews.length === 0) {
      isReviewTimeoutJobRunning = false;
      return;
    }

    Promise.allSettled([
      notifyMany(
        pool,
        completedReviews.map((rental) => ({
          userId: rental.tenant_id,
          entityType: "RENTAL",
          entityId: rental.rental_id,
          type: "RENTAL_REVIEW_TIMEOUT",
          message: `Rating review period has expired for rental #${rental.rental_id}. Lease has been completed and deposit returned.`,
        })),
      ),
      notifyMany(
        pool,
        completedReviews.map((rental) => ({
          userId: rental.landlord_id,
          entityType: "RENTAL",
          entityId: rental.rental_id,
          type: "RENTAL_REVIEW_TIMEOUT",
          message: `Rating review period has expired for rental #${rental.rental_id}. Lease has been completed and deposit returned.`,
        })),
      ),
    ]).then((results) => {
      results.forEach((result, idx) => {
        if (result.status === "rejected") {
          const channel = idx === 0 ? "tenant" : "landlord";
          console.error(
            `[REVIEW_TIMEOUT] ${channel} notifications failed:`,
            result.reason,
          );
        }
      });
    });
  } catch (err) {
    console.error("[REVIEW_TIMEOUT] Job failed:", err);
  } finally {
    isReviewTimeoutJobRunning = false;
  }
});

// Rent Payment Notification Job - sends notifications to tenants when rent is due or coming due
// TODO: adjust cron schedule in production, can run daily or every 12 hours
cron.schedule("*/30 * * * * *", async () => {
  if (isRentPaymentNotificationRunning) {
    return;
  }

  isRentPaymentNotificationRunning = true;
  try {
    const [rentDueAgreements] = await pool.query(
      `SELECT
          r.id AS rental_id,
          r.tenant_id,
          r.landlord_id,
          r.start_date,
          r.lease_duration,
          TIMESTAMPDIFF(SECOND, r.start_date, NOW()) AS seconds_elapsed
      FROM rental_agreements r
      WHERE r.status = 'ACTIVE'
        AND TIMESTAMPDIFF(SECOND, r.start_date, NOW()) >= 0`,
    );

    if (rentDueAgreements.length === 0) {
      isRentPaymentNotificationRunning = false;
      return;
    }

    const tenantsToNotify = [];

    for (const rental of rentDueAgreements) {
      // Calculate the next rent due time based on rental start and interval
      const cyclesSinceStart = Math.floor(
        rental.seconds_elapsed / RENT_INTERVAL_SECONDS,
      );
      const nextRentDueSeconds = (cyclesSinceStart + 1) * RENT_INTERVAL_SECONDS;
      const secondsUntilNextRent = nextRentDueSeconds - rental.seconds_elapsed;

      // Check if rent is due within the notification buffer
      // or if rent is already overdue (secondsUntilNextRent <= 0)
      if (secondsUntilNextRent <= RENT_DUE_NOTIFICATION_SECONDS) {
        tenantsToNotify.push({
          userId: rental.tenant_id,
          entityType: "RENTAL",
          entityId: rental.rental_id,
          type: "RENT_DUE_SOON",
          message: `Rent payment is due for rental #${rental.rental_id}. Please make sure to pay before the deadline.`,
        });
      }
    }

    if (tenantsToNotify.length === 0) {
      isRentPaymentNotificationRunning = false;
      return;
    }

    await notifyMany(pool, tenantsToNotify).catch((err) => {
      console.error(
        "[RENT_PAYMENT_NOTIFICATION] Failed to send notifications:",
        err,
      );
    });
  } catch (err) {
    console.error("[RENT_PAYMENT_NOTIFICATION] Job failed:", err);
  } finally {
    isRentPaymentNotificationRunning = false;
  }
});
