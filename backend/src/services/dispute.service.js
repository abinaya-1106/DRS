import pool from "../config/db.js";
import { generateDisputeDecision } from "./gemini.service.js";
import { notifyMany } from "./notification.service.js";
import {
  getDisputeVotesOnChain,
  resolveDisputeWithPayoutOnChain,
  setDisputeStatusOnChain,
} from "./blockchain.service.js";

const newTrust = (currentTrust, change) => {
  return Math.max(0, Math.min(100, currentTrust + change));
};

const syncDisputeStatusOnChain = async (dispute) => {
  if (
    dispute.blockchain_index === null ||
    dispute.blockchain_index === undefined
  ) {
    return;
  }

  const [[remainingOpenDisputes]] = await pool.query(
    `SELECT COUNT(*) AS openCount
      FROM disputes
      WHERE rental_id = ? AND status != 'RESOLVED'`,
    [dispute.rental_id],
  );

  await setDisputeStatusOnChain(
    Number(dispute.blockchain_index),
    Number(remainingOpenDisputes.openCount) > 0,
  );
};

export const resolveDispute = async (disputeId) => {
  let conn;

  try {
    conn = await pool.getConnection();

    const [[dispute]] = await conn.query(
      `SELECT
          d.ai_decision,
          d.tenant_accepted,
          d.landlord_accepted,
          d.start_time,
          d.duration,

          r.tenant_id,
          r.landlord_id,
          r.id AS rental_id,
          ca.blockchain_index
        FROM disputes d
        JOIN rental_agreements r
          ON d.rental_id = r.id
        JOIN contract_agreements ca
          ON ca.rental_agreement_id = r.id
        WHERE
          d.id = ? AND
          (d.tenant_accepted IS NOT NULL OR d.landlord_accepted IS NOT NULL) AND
          d.status IN ('AI_SUGGESTED', 'VOTING_OPEN')`,
      [disputeId],
    );

    if (!dispute) {
      return "Dispute not found for resolution";
    }

    const bothAccepted =
      dispute.tenant_accepted === 1 && dispute.landlord_accepted === 1;

    const votingEnded =
      Date.now() >= new Date(dispute.start_time).getTime() + dispute.duration;

    // If both parties accepted the AI decision, we can resolve the dispute immediately, without modifying trust scores
    if (bothAccepted) {
      await conn.beginTransaction();

      await conn.query(
        `UPDATE disputes
          SET status = 'RESOLVED', final_decision = ?
          WHERE id = ?`,
        [dispute.ai_decision, disputeId],
      );

      await conn.commit();

      await syncDisputeStatusOnChain(dispute);

      return "Dispute resolved successfully with AI decision";
    }

    if (!votingEnded) {
      return "Dispute is not resolved by AI decision and voting is still in progress";
    }

    let tenantVotes = 0;
    let landlordVotes = 0;

    try {
      const onChainVotes = await getDisputeVotesOnChain(disputeId);
      tenantVotes = onChainVotes.tenantVotes;
      landlordVotes = onChainVotes.landlordVotes;
    } catch {
      // Fall back to DB vote totals when on-chain read is unavailable.
      const [votes] = await conn.query(
        `SELECT vote
          FROM dispute_votes
          WHERE dispute_id = ?`,
        [disputeId],
      );

      votes.forEach((vote) => {
        if (vote.vote === "TENANT") ++tenantVotes;
        else if (vote.vote === "LANDLORD") ++landlordVotes;
      });
    }

    const [parties] = await conn.query(
      `SELECT trust_score, role
          FROM users
          WHERE id IN (?, ?)
          ORDER BY CASE
            WHEN role = 'TENANT' THEN 0
            WHEN role = 'LANDLORD' THEN 1
            ELSE 2
          END`, // Ensure tenant is first and landlord is second based on role
      [dispute.tenant_id, dispute.landlord_id],
    );

    let final_decision = tenantVotes > landlordVotes ? "TENANT" : "LANDLORD";
    // TODO: handle tie cases (e.g., based on trust scores or default to UNCERTAIN)

    // trust score range must be between 0 and 100, so we need to cap the changes accordingly
    let tenantTrustChange = final_decision === "TENANT" ? 10 : -5;
    let landlordTrustChange = final_decision === "LANDLORD" ? 10 : -5;

    // Cap the trust score changes to ensure they stay within the 0-100 range
    let tenantNewTrust = newTrust(parties[0].trust_score, tenantTrustChange);
    let landlordNewTrust = newTrust(
      parties[1].trust_score,
      landlordTrustChange,
    );

    await conn.beginTransaction();

    // Updated trust scores for both parties based on the dispute outcome
    await conn.query(
      `UPDATE users
          SET trust_score = CASE
            WHEN id = ? THEN ?
            WHEN id = ? THEN ?
            ELSE trust_score
          END
          WHERE id IN (?, ?)`,
      [
        dispute.tenant_id,
        tenantNewTrust,
        dispute.landlord_id,
        landlordNewTrust,
        dispute.tenant_id,
        dispute.landlord_id,
      ],
    );

    if (
      dispute.blockchain_index !== null &&
      dispute.blockchain_index !== undefined
    ) {
      await resolveDisputeWithPayoutOnChain(
        Number(dispute.blockchain_index),
        final_decision === "TENANT",
      );
    }

    await conn.query(
      `UPDATE disputes
        SET status = 'RESOLVED', final_decision = ?
        WHERE id = ?`,
      [final_decision, disputeId],
    );

    await conn.commit();

    await syncDisputeStatusOnChain(dispute);

    return `Dispute resolved successfully with voting outcome and ${final_decision} as final decision and tenant trust score updated to ${tenantNewTrust} and landlord trust score updated to ${landlordNewTrust} and some percentage of deposit paid out to the winner on chain if applicable`;
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // Ignore rollback errors from non-active transactions.
      }
    }

    console.error("Error resolving dispute:", err);
    return "Internal server error";
  } finally {
    if (conn) conn.release();
  }
};

export const processDisputeAiDecision = async (disputeId) => {
  let conn;

  try {
    conn = await pool.getConnection();

    // Fetch dispute and rental context
    const [[rentalContext]] = await conn.query(
      `SELECT
          d.raised_by,
          d.description AS dispute_description,
          d.evidence_url,
          r.tenant_id,
          r.landlord_id,
          p.title AS property_title,
          p.location AS property_address,
          p.rent_amount,
          p.security_deposit,
          r.lease_duration,
          r.start_date,
          r.id AS rental_id,
          l.username AS landlord_name,
          t.username AS tenant_name,
          p.terms_and_conditions
        FROM disputes d
        JOIN rental_agreements r ON d.rental_id = r.id
        JOIN properties p ON r.property_id = p.id
        JOIN users l ON r.landlord_id = l.id
        JOIN users t ON r.tenant_id = t.id
        WHERE d.id = ?`,
      [disputeId],
    );

    if (!rentalContext) {
      console.error(`Dispute ${disputeId} not found for AI processing`);
      return;
    }

    // Fetch payment history for this rental
    const [paymentHistory] = await conn.query(
      `SELECT
          periods_paid,
          amount_paid,
          previous_period_index,
          new_period_index,
          paid_timestamp
        FROM rent_payments
        WHERE rental_id = ?
        ORDER BY paid_timestamp DESC
        LIMIT 10`,
      [rentalContext.rental_id],
    );

    // Get AI decision (safeParseDecision handles all errors internally)
    const aiOutcome = await generateDisputeDecision({
      ...rentalContext,
      contract_text: rentalContext.terms_and_conditions || "",
      payment_history: paymentHistory || [],
    });

    // Update dispute with AI decision and change status to AI_SUGGESTED
    await conn.query(
      `UPDATE disputes
        SET status = 'AI_SUGGESTED', ai_decision = ?, ai_reasoning = ?
        WHERE id = ?`,
      [aiOutcome.ai_decision, aiOutcome.ai_reasoning, disputeId],
    );

    await notifyMany(
      pool,
      [rentalContext.tenant_id, rentalContext.landlord_id].map(
        (targetUserId) => ({
          userId: targetUserId,
          entityType: "DISPUTE",
          type: "DISPUTE_AI_SUGGESTED",
          message:
            "AI has suggested a dispute resolution. Please review and respond.",
          metadata: {
            dispute_id: disputeId,
            ai_decision: aiOutcome.ai_decision,
          },
        }),
      ),
    );

    // TODO: remove this console log after testing
    console.log(
      `AI decision processed for dispute ${disputeId}: ${aiOutcome.ai_decision}`,
    );
  } catch (err) {
    console.error(
      `Error processing AI decision for dispute ${disputeId}:`,
      err,
    );
  } finally {
    if (conn) conn.release();
  }
};
