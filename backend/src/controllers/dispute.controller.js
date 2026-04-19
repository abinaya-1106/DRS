import pool from "../config/db.js";
import {
  processDisputeAiDecision,
  resolveDispute,
} from "../services/dispute.service.js";
import {
  storeDisputeOnChain,
  voteOnDisputeOnChain,
  setDisputeStatusOnChain,
} from "../services/blockchain.service.js";
import { VOTING_DURATION_SECONDS } from "../config/env.js";
import { notify, notifyMany } from "../services/notification.service.js";

export const createDispute = async (req, res) => {
  const userId = req.user.id;
  const { rentalId, description, evidence_url = null } = req.body;

  if (!rentalId || !description) {
    return res
      .status(400)
      .json({ message: "Rental ID and description are required" });
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[rental]] = await conn.query(
      `SELECT tenant_id, landlord_id
        FROM rental_agreements
        WHERE id = ? AND (tenant_id = ? OR landlord_id = ?) AND status = 'ACTIVE'`,
      [rentalId, userId, userId],
    );

    if (!rental) {
      await conn.rollback();
      return res.status(404).json({ message: "Rental not found" });
    }

    const raisedBy = rental.tenant_id === userId ? "TENANT" : "LANDLORD";
    const opponentId =
      raisedBy === "TENANT" ? rental.landlord_id : rental.tenant_id;

    const [insertResult] = await conn.query(
      `INSERT INTO disputes (rental_id, raised_by, description, evidence_url)
        VALUES (?, ?, ?, ?)`,
      [rentalId, raisedBy, description, evidence_url],
    );

    const disputeId = insertResult.insertId;

    const [[agreement]] = await conn.query(
      `SELECT ca.blockchain_index
        FROM contract_agreements ca
        WHERE ca.rental_agreement_id = ?`,
      [rentalId],
    );

    await conn.commit();

    await notify(pool, {
      userId: opponentId,
      entityType: "DISPUTE",
      type: "DISPUTE_RAISED",
      message: "A new dispute has been raised for one of your active rentals.",
      metadata: {
        dispute_id: disputeId,
        rental_id: rentalId,
        raised_by: raisedBy,
      },
    });

    // Return immediately and process AI decision in the background
    res.status(201).json({
      message: "Dispute raised successfully",
      dispute: { id: disputeId, status: "RAISED" },
    });

    // Mirror dispute creation on-chain without blocking user response.
    setImmediate(async () => {
      try {
        await storeDisputeOnChain(disputeId);

        if (
          agreement?.blockchain_index !== null &&
          agreement?.blockchain_index !== undefined
        ) {
          await setDisputeStatusOnChain(
            Number(agreement.blockchain_index),
            true,
          );
        }
      } catch (chainErr) {
        console.error(
          `Failed to store dispute ${disputeId} on-chain:`,
          chainErr,
        );
      }
    });

    // Process AI decision in the background (non-blocking)
    setImmediate(() => {
      processDisputeAiDecision(disputeId);
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error("Error creating dispute:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    if (conn) conn.release();
  }
};

export const updateAiDecisionResponse = async (req, res) => {
  const userId = req.user.id;
  const disputeId = req.params.id;
  const accepted = req.body.accepted; // true for accept, false for reject

  if (typeof accepted !== "boolean") {
    return res
      .status(400)
      .json({ message: "Accepted field must be a boolean" });
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[dispute]] = await conn.query(
      `SELECT
          r.tenant_id AS tenant_id,
          r.landlord_id AS landlord_id
        FROM disputes d
        JOIN rental_agreements r ON d.rental_id = r.id
        WHERE
          d.id = ? AND
          d.status = 'AI_SUGGESTED' AND
          (r.tenant_id = ? OR r.landlord_id = ?) AND
          (
            (? = r.tenant_id AND d.tenant_accepted IS NULL) OR
            (? = r.landlord_id AND d.landlord_accepted IS NULL)
          )`,
      [disputeId, userId, userId, userId, userId],
    );

    if (!dispute) {
      await conn.rollback();
      return res.status(404).json({ message: "Dispute not found" });
    }

    const isTenant = dispute.tenant_id === userId;
    const acceptedColumn = isTenant ? "tenant_accepted" : "landlord_accepted";

    await conn.query(
      `UPDATE disputes
        SET ${acceptedColumn} = ?
        WHERE id = ?`,
      [accepted, disputeId],
    );

    const [[updatedDispute]] = await conn.query(
      `SELECT tenant_accepted, landlord_accepted
        FROM disputes
        WHERE id = ?`,
      [disputeId],
    );

    const isRejected =
      updatedDispute.tenant_accepted === 0 ||
      updatedDispute.landlord_accepted === 0;

    const isBothAccepted =
      updatedDispute.tenant_accepted === 1 &&
      updatedDispute.landlord_accepted === 1;

    // If either of the parties rejects the AI decision, we can open it up for voting by other users with high trust scores.
    if (isRejected) {
      await conn.query(
        `UPDATE disputes
          SET status = 'VOTING_OPEN', start_time = NOW(), duration = ?
          WHERE id = ?`,
        [VOTING_DURATION_SECONDS, disputeId],
      );
    }

    await conn.commit();

    if (isRejected) {
      await notifyMany(
        pool,
        [dispute.tenant_id, dispute.landlord_id].map((targetUserId) => ({
          userId: targetUserId,
          entityType: "DISPUTE",
          type: "DISPUTE_VOTING_OPEN",
          message: "Your dispute has moved to community voting.",
          metadata: { dispute_id: Number(disputeId) },
        })),
      );
    }

    // If both parties accepted the AI decision, we can resolve the dispute.
    if (isBothAccepted) {
      const resolutionMessage = await resolveDispute(disputeId);

      await notifyMany(
        pool,
        [dispute.tenant_id, dispute.landlord_id].map((targetUserId) => ({
          userId: targetUserId,
          entityType: "DISPUTE",
          type: "DISPUTE_RESOLVED",
          message: resolutionMessage,
          metadata: { dispute_id: Number(disputeId) },
        })),
      );
    }

    res.status(200).json({
      message:
        `AI decision  ` +
        (accepted ? "accepted" : "rejected") +
        " successfully",
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error("Error accepting AI decision:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    if (conn) conn.release();
  }
};

export const getDisputes = async (req, res) => {
  const userId = req.user.id;

  try {
    // Fetch disputes where the user is involved as tenant, landlord, or has a trust score >= 75 and the dispute is open for voting (we can change it later)
    const [disputes] = await pool.query(
      `SELECT d.*
        FROM disputes d
        JOIN rental_agreements r ON d.rental_id = r.id
        JOIN users u ON u.id = ?
        WHERE r.tenant_id = u.id
           OR r.landlord_id = u.id
           OR (u.trust_score >= 75 AND d.status = 'VOTING_OPEN')`,
      [userId],
    );

    res.status(200).json({ disputes });
  } catch (err) {
    console.error("Error fetching disputes:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const voteDispute = async (req, res) => {
  const userId = req.user.id;
  const { disputeId, vote } = req.body;

  if (!disputeId || !vote || !["TENANT", "LANDLORD"].includes(vote)) {
    return res.status(400).json({ message: "Invalid dispute ID or vote" });
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[dispute]] = await conn.query(
      `SELECT
          r.tenant_id,
          r.landlord_id
        FROM disputes d
        JOIN rental_agreements r
          ON d.rental_id = r.id
        JOIN users u
          ON u.id = ?
        WHERE
          d.id = ? AND
          d.status = 'VOTING_OPEN' AND
          u.id NOT IN (r.tenant_id, r.landlord_id) AND
          u.trust_score >= 75`,
      [userId, disputeId],
    );

    if (!dispute) {
      await conn.rollback();
      return res
        .status(404)
        .json({ message: "Dispute not found or not eligible for voting" });
    }

    await conn.query(
      `INSERT INTO dispute_votes (dispute_id, user_id, vote)
        VALUES (?, ?, ?)`,
      [disputeId, userId, vote],
    );

    await conn.commit();

    await notifyMany(
      pool,
      [dispute.tenant_id, dispute.landlord_id].map((targetUserId) => ({
        userId: targetUserId,
        entityType: "DISPUTE",
        type: "DISPUTE_VOTE_CAST",
        message: "A community member has cast a vote on your dispute.",
        metadata: { dispute_id: Number(disputeId), vote },
      })),
    );

    // Mirror vote on-chain as best-effort; DB remains source of truth.
    try {
      await voteOnDisputeOnChain(
        disputeId,
        vote === "TENANT",
        req.user.address,
      );
    } catch (chainErr) {
      console.error(
        `Failed to mirror vote on-chain for dispute ${disputeId}:`,
        chainErr,
      );
    }

    res.status(200).json({ message: "Vote cast successfully" });
  } catch (err) {
    if (conn) await conn.rollback();
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "User has already voted." });
    }
    console.error("Error voting on dispute:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    if (conn) conn.release();
  }
};
