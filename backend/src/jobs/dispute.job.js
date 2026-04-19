import cron from "node-cron";
import pool from "../config/db.js";
import { resolveDispute } from "../services/dispute.service.js";
import { notifyMany } from "../services/notification.service.js";

cron.schedule("0 * * * * *", async () => {
  const [expired] = await pool.query(
    `SELECT
        d.id,
        r.tenant_id,
        r.landlord_id
      FROM disputes d
      JOIN rental_agreements r ON d.rental_id = r.id
      WHERE d.status = 'VOTING_OPEN'
        AND (d.start_time + INTERVAL d.duration SECOND) <= NOW()`,
  );

  for (const dispute of expired) {
    try {
      const message = await resolveDispute(dispute.id);

      await notifyMany(
        pool,
        [dispute.tenant_id, dispute.landlord_id].map((userId) => ({
          userId: userId,
          entityType: "DISPUTE",
          type: "DISPUTE_RESOLVED",
          message: message,
          metadata: { dispute_id: dispute.id },
        })),
      );

      console.log(`Auto resolved dispute with ID ${dispute.id}`);
    } catch (error) {
      console.error(`Error resolving dispute with ID ${dispute.id}:`, error);
    }
  }
});
