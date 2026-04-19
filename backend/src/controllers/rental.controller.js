import pool from "../config/db.js";
import { generateAgreementHTML } from "../services/gemini.service.js";
import generatePDF from "../utils/pdfGenerator.js";
import { uploadAgreementOnIPFS } from "../services/ipfs.service.js";
import {
  storeAgreement,
  getAgreement,
  getAgreementsCount,
  getAgreementIndexFromTxHash,
  getRentDues as getRentDuesOnChain,
  provider,
} from "../services/blockchain.service.js";
import { ethers } from "ethers";
import contractAddress from "../config/contractAddress.json" with { type: "json" };
import { notify, notifyMany } from "../services/notification.service.js";

export const applyForRental = async (req, res) => {
  const tenantId = req.user.id;
  const { propertyId, lease_duration } = req.body || {};

  if (!propertyId) {
    return res.status(400).json({
      message: "Missing propertyId in request body",
    });
  }

  if (!lease_duration || isNaN(lease_duration) || lease_duration <= 0) {
    return res.status(400).json({
      message: "Invalid lease_duration, must be a positive number",
    });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    // Check if property exists and is available, which also means there is no APPROVED rental for this property
    const [[property]] = await conn.query(
      "SELECT landlord_id FROM properties WHERE id = ? AND is_available = true",
      [propertyId],
    );

    if (!property) {
      await conn.rollback();
      return res
        .status(404)
        .json({ message: "Property not found or unavailable" });
    }

    // this tenant already applied for this property and the request is still pending or already approved or active, so cannot apply again
    const [[existingStatus]] = await conn.query(
      `SELECT status
        FROM rental_agreements
        WHERE property_id = ? 
            AND tenant_id = ? 
            AND status IN ('PENDING', 'APPROVED', 'ACTIVE')
        ORDER BY FIELD(status, 'PENDING', 'APPROVED', 'ACTIVE')
        LIMIT 1`,
      [propertyId, tenantId],
    );

    if (existingStatus) {
      await conn.rollback();

      let message;
      switch (existingStatus.status) {
        case "PENDING":
          message =
            "You already have a pending rental request for this property";
          break;
        case "APPROVED":
          message = "You already have an approved rental for this property";
          break;
        case "ACTIVE":
          message = "You already have an active rental for this property";
          break;
        default:
          message =
            "You already have an existing rental agreement for this property";
      }

      return res.status(400).json({ message });
    }

    // Create rental record
    const [insertResult] = await conn.query(
      `INSERT INTO rental_agreements (
            property_id,
            tenant_id,
            landlord_id,
            lease_duration,
            status
        ) VALUES (?, ?, ?, ?, 'PENDING')`,
      [propertyId, tenantId, property.landlord_id, lease_duration],
    );

    if (insertResult.affectedRows === 0) {
      await conn.rollback();
      return res
        .status(500)
        .json({ message: "Failed to create rental request" });
    }

    // Notify landlord about the new rental request
    await notify(conn, {
      userId: property.landlord_id,
      entityType: "RENTAL",
      type: "RENTAL_REQUEST",
      message: "You have a new rental request for your property.",
      metadata: { rental_id: insertResult.insertId },
    });

    await conn.commit();
    return res
      .status(201)
      .json({ message: "Rental request sent successfully" });
  } catch (err) {
    console.error("Error applying rental:", err);
    await conn.rollback();
    return res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
};

export const cancelRentalRequest = async (req, res) => {
  const tenantId = req.user.id;
  const rentalId = req.params.id;

  try {
    const [[rental]] = await pool.query(
      `SELECT
          r.landlord_id,
          p.title AS property_name
        FROM rental_agreements r
        JOIN properties p ON r.property_id = p.id
        WHERE r.id = ? AND r.tenant_id = ? AND r.status = 'PENDING'`,
      [rentalId, tenantId],
    );

    const [deletedRental] = await pool.query(
      `DELETE FROM rental_agreements
        WHERE id = ? AND tenant_id = ? AND status = 'PENDING'`,
      [rentalId, tenantId],
    );

    if (deletedRental.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "Rental request not found or already processed" });
    }

    await notify(pool, {
      userId: rental.landlord_id,
      entityType: "RENTAL",
      type: "RENTAL_REQUEST_CANCELLED",
      message: "User cancelled the rental request for your property.",
      metadata: { property_name: rental.property_name },
    });

    res.status(200).json({ message: "Rental request canceled" });
  } catch (err) {
    console.error("Error canceling rental:", err);
    res.status(500).json({ message: "Database error" });
  }
};

export const rejectRentalRequest = async (req, res) => {
  const landlordId = req.user.id;
  const rentalId = req.params.id;

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Fetch rental agreement
    const [[rental]] = await conn.query(
      `SELECT tenant_id
        FROM rental_agreements r
        JOIN properties p ON r.property_id = p.id
        WHERE r.id = ? AND r.landlord_id = ? AND r.status = 'PENDING'
        FOR UPDATE`,
      [rentalId, landlordId],
    );

    if (!rental) {
      await conn.rollback();
      return res
        .status(404)
        .json({ message: "Rental request not found or already processed" });
    }

    // Update rental agreement status to REJECTED
    const [updateResult] = await conn.query(
      `UPDATE rental_agreements
        SET status = 'REJECTED'
        WHERE id = ? AND landlord_id = ? AND status = 'PENDING'`,
      [rentalId, landlordId],
    );

    if (updateResult.affectedRows === 0) {
      await conn.rollback();
      return res
        .status(409)
        .json({ message: "Rental request not found or already processed" });
    }

    // Notify tenant
    await notify(conn, {
      userId: rental.tenant_id,
      entityType: "RENTAL",
      type: "RENTAL_REJECTED",
      message: `Your rental request has been rejected.`,
      metadata: { rental_id: rentalId },
    });

    await conn.commit();
    res.status(200).json({ message: "Rental request rejected" });
  } catch (err) {
    console.error("Error rejecting rental:", err);
    await conn.rollback();
    res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
};

export const listRentals = async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const [rentals] = await pool.query(
      `SELECT id, status
        FROM rental_agreements
        WHERE ${userRole === "TENANT" ? "tenant_id" : "landlord_id"} = ?
        ORDER BY created_at DESC`,
      [userId],
    );

    res.status(200).json({ rentals }); // frontend can fetch property details from the rental details endpoint if needed
  } catch (err) {
    console.error("Error fetching rentals:", err);
    res.status(500).json({ message: "Database error" });
  }
};

export const getRentalDetails = async (req, res) => {
  const rentalId = req.params.id;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const [[rental]] = await pool.query(
      `SELECT
          r.id,

          p.id AS property_id,

          p.title AS property_title,
          p.description AS property_description,

          p.location AS property_location,
          p.city AS property_city,

          pt.name AS property_type,

          p.rent_amount,
          p.security_deposit,
          p.maintenance_charge,

          p.bedrooms,
          p.bathrooms,
          p.area_sqft,

          p.max_tenants,

          p.furnishing_status,

          p.terms_and_conditions,
          p.rating AS property_rating,

          t.id AS tenant_id,
          t.username AS tenant_name,
          t.phone AS tenant_phone,

          l.id AS landlord_id,
          l.username AS landlord_name,
          l.phone AS landlord_phone,

          r.start_date,
          r.lease_duration,
          
          r.status,

          r.tenant_reviewed,
          r.landlord_reviewed,

          r.created_at,
          r.updated_at,

          ca.blockchain_index,
          ca.blockchain_tx_hash,
          ca.tenant_address,
          ca.landlord_address,
          ca.agreement_ipfs_hash,
          ca.tenant_signature,
          ca.landlord_signature
        FROM rental_agreements r
        JOIN properties p ON r.property_id = p.id
        JOIN property_types pt ON p.property_type_id = pt.id
        JOIN users t ON r.tenant_id = t.id
        JOIN users l ON r.landlord_id = l.id
        LEFT JOIN contract_agreements ca ON ca.rental_agreement_id = r.id
        WHERE r.id = ? AND (
            ( ? = 'TENANT' AND r.tenant_id = ? ) OR
            ( ? = 'LANDLORD' AND r.landlord_id = ? )
        )`,
      [rentalId, userRole, userId, userRole, userId],
    );

    if (!rental) {
      return res.status(404).json({ message: "Rental agreement not found" });
    }

    // Recover stale blockchain index from tx logs; if still invalid and pending
    // deposit, redeploy using stored signed agreement data.
    if (
      rental.blockchain_index !== null &&
      rental.blockchain_index !== undefined &&
      rental.blockchain_tx_hash
    ) {
      const currentIndex = Number(rental.blockchain_index);
      const agreementsCount = await getAgreementsCount();

      if (currentIndex >= agreementsCount) {
        const correctedIndex = await getAgreementIndexFromTxHash(
          rental.blockchain_tx_hash,
        );

        if (
          correctedIndex !== null &&
          correctedIndex !== undefined &&
          correctedIndex < agreementsCount
        ) {
          await pool.query(
            `UPDATE contract_agreements
              SET blockchain_index = ?
              WHERE rental_agreement_id = ?`,
            [correctedIndex, rentalId],
          );

          rental.blockchain_index = correctedIndex;
        } else if (
          rental.status === "PENDING_DEPOSIT" &&
          rental.tenant_address &&
          rental.landlord_address &&
          rental.agreement_ipfs_hash &&
          rental.tenant_signature &&
          rental.landlord_signature
        ) {
          const { txHash, agreementIndex } = await storeAgreement(
            rental.tenant_address,
            rental.landlord_address,
            rental.agreement_ipfs_hash,
            rental.tenant_signature,
            rental.landlord_signature,
            Math.floor(new Date(rental.start_date).getTime() / 1000),
            parseInt(rental.lease_duration),
            ethers.parseEther(rental.rent_amount.toString()),
            ethers.parseEther(rental.security_deposit.toString()),
          );

          await pool.query(
            `UPDATE contract_agreements
              SET blockchain_index = ?, blockchain_tx_hash = ?
              WHERE rental_agreement_id = ?`,
            [agreementIndex, txHash, rentalId],
          );

          rental.blockchain_index = agreementIndex;
          rental.blockchain_tx_hash = txHash;
        }
      }
    }

    res.status(200).json({ rental });
  } catch (err) {
    console.error("Error fetching rental details:", err);
    res.status(500).json({ message: "Database error" });
  }
};

export const getRentalRentDues = async (req, res) => {
  const rentalId = req.params.id;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const [[rental]] = await pool.query(
      `SELECT
          r.id,
          p.rent_amount,
          ca.blockchain_index
        FROM rental_agreements r
        JOIN properties p ON p.id = r.property_id
        JOIN contract_agreements ca ON ca.rental_agreement_id = r.id
        WHERE r.id = ? AND (
            ( ? = 'TENANT' AND r.tenant_id = ? ) OR
            ( ? = 'LANDLORD' AND r.landlord_id = ? )
        )`,
      [rentalId, userRole, userId, userRole, userId],
    );

    if (!rental) {
      return res.status(404).json({ message: "Rental agreement not found" });
    }

    if (
      rental.blockchain_index === null ||
      rental.blockchain_index === undefined
    ) {
      return res.status(400).json({
        message: "Agreement is not deployed on blockchain yet",
      });
    }

    const dues = await getRentDuesOnChain(Number(rental.blockchain_index));

    return res.status(200).json({
      rentalId: Number(rental.id),
      blockchainIndex: Number(rental.blockchain_index),
      rentAmount: rental.rent_amount,
      duePeriodsCount: dues.duePeriodsCount,
      dueAmountWei: dues.dueAmount,
      dueAmountEth: ethers.formatEther(dues.dueAmount),
      hasDue: dues.duePeriodsCount > 0,
    });
  } catch (err) {
    console.error("Error fetching rent dues:", err);
    return res.status(500).json({
      message: "Failed to fetch rent dues",
    });
  }
};

export const processAgreementWorkflow = async (req, res) => {
  const rentalId = req.params.id;
  const { signature, message, txHash } = req.body || {};
  const userId = req.user.id;
  const userRole = req.user.role;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [[rentalWithAgreement]] = await conn.query(
      `SELECT
          r.id,
          r.property_id,
          r.tenant_id,
          r.start_date,
          r.lease_duration,
          r.status AS rental_status,
          p.rent_amount,
          p.security_deposit,
          ca.id AS contract_agreement_id,
          ca.landlord_address,
          ca.tenant_address,
          ca.agreement_ipfs_hash,
          ca.landlord_signature,
          ca.status,
          ca.blockchain_index
      FROM rental_agreements r
      JOIN properties p ON p.id = r.property_id
      LEFT JOIN contract_agreements ca ON ca.rental_agreement_id = r.id
      WHERE r.id = ? AND (
        (
          ? = 'TENANT'
          AND r.tenant_id = ?
          AND (r.status IN ('APPROVED', 'PENDING_DEPOSIT') OR ca.status = 'DEPLOYED')
        ) OR
        (
          ? = 'LANDLORD'
          AND r.landlord_id = ?
          AND r.status IN ('PENDING', 'APPROVED')
        )
      )
      FOR UPDATE`,
      [rentalId, userRole, userId, userRole, userId],
    );

    if (!rentalWithAgreement) {
      await conn.rollback();
      return res.status(404).json({ message: "Rental agreement not found" });
    }

    if (userRole === "LANDLORD") {
      if (!signature || !message) {
        await conn.rollback();
        return res
          .status(400)
          .json({ message: "Signature and message are required" });
      }

      const signerAddress = ethers.verifyMessage(message, signature);
      if (signerAddress.toLowerCase() !== req.user.address.toLowerCase()) {
        await conn.rollback();
        return res
          .status(401)
          .json({ message: "Signature verification failed" });
      }

      if (
        !["PENDING", "APPROVED"].includes(rentalWithAgreement.rental_status)
      ) {
        await conn.rollback();
        return res.status(400).json({
          message:
            "Rental agreement must be in PENDING/APPROVED status for landlord sign",
        });
      }

      let contractAgreementId = rentalWithAgreement.contract_agreement_id;

      // If agreement was never generated (or generation failed earlier), generate now and continue sign.
      if (!rentalWithAgreement.agreement_ipfs_hash) {
        const [startDateUpdate] = await conn.query(
          `UPDATE rental_agreements
            SET start_date = COALESCE(start_date, NOW())
            WHERE id = ?`,
          [rentalId],
        );

        if (startDateUpdate.affectedRows === 0) {
          await conn.rollback();
          return res.status(409).json({
            message:
              "Rental agreement status changed. Please refresh and retry.",
          });
        }

        const [[rentalForDoc]] = await conn.query(
          `SELECT
              l.id AS landlord_id,
              l.username AS landlord_name,
              t.id AS tenant_id,
              t.username AS tenant_name,
              p.title AS property_title,
              p.location AS property_address,
              p.bedrooms AS bedroom_count,
              p.bathrooms AS bathroom_count,
              p.area_sqft AS area,
              p.max_tenants AS max_tenants,
              p.furnishing_status AS furnishing_status,
              p.rent_amount AS rent_amount,
              p.security_deposit AS security_deposit,
              p.maintenance_charge AS maintenance_charges,
              p.terms_and_conditions AS terms_and_conditions,
              r.start_date AS startDate,
              r.lease_duration AS lease_duration
            FROM rental_agreements r
            JOIN properties p ON r.property_id = p.id
            JOIN users l ON r.landlord_id = l.id
            JOIN users t ON r.tenant_id = t.id
            WHERE r.id = ?`,
          [rentalId],
        );

        const [[tenantWallet]] = await conn.query(
          `SELECT wallet_address FROM users WHERE id = ?`,
          [rentalForDoc.tenant_id],
        );

        const html = await generateAgreementHTML(rentalForDoc);
        const pdfBuffer = await generatePDF(html);
        const ipfsHash = await uploadAgreementOnIPFS(
          pdfBuffer,
          rentalForDoc.landlord_id,
          rentalForDoc.tenant_id,
        );

        const [agreementInsert] = await conn.query(
          `INSERT INTO contract_agreements (
            rental_agreement_id,
            agreement_ipfs_hash,
            landlord_address,
            tenant_address
          ) VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            agreement_ipfs_hash = VALUES(agreement_ipfs_hash),
            landlord_address = VALUES(landlord_address),
            tenant_address = VALUES(tenant_address)`,
          [rentalId, ipfsHash, req.user.address, tenantWallet.wallet_address],
        );

        contractAgreementId = agreementInsert.insertId || contractAgreementId;
      }

      if (!rentalWithAgreement.landlord_signature) {
        await conn.query(
          `UPDATE contract_agreements
            SET landlord_signature = ?
            WHERE rental_agreement_id = ?`,
          [signature, rentalId],
        );
      }

      const [approveResult] = await conn.query(
        `UPDATE rental_agreements
          SET status = 'APPROVED'
          WHERE id = ?`,
        [rentalId],
      );

      if (approveResult.affectedRows === 0) {
        await conn.rollback();
        return res.status(409).json({
          message: "Rental agreement status changed. Please refresh and retry.",
        });
      }

      await conn.query(
        `UPDATE properties
          SET is_available = false
          WHERE id = ?`,
        [rentalWithAgreement.property_id],
      );

      await notify(conn, {
        userId: rentalWithAgreement.tenant_id,
        entityType: "RENTAL",
        type: "RENTAL_AGREEMENT_GENERATED",
        message:
          "The rental agreement is ready and signed by landlord. Please sign and pay deposit to activate rental.",
        metadata: {
          rental_id: rentalId,
        },
      });

      const [otherPendingRentals] = await conn.query(
        `SELECT id, tenant_id FROM rental_agreements
          WHERE property_id = ? AND status = 'PENDING' AND id != ?`,
        [rentalWithAgreement.property_id, rentalId],
      );

      if (otherPendingRentals.length > 0) {
        const otherRentalIds = otherPendingRentals.map((r) => r.id);
        const otherTenantIds = otherPendingRentals.map((r) => r.tenant_id);

        await conn.query(
          `UPDATE rental_agreements
            SET status = 'REJECTED'
            WHERE id IN (?) AND status = 'PENDING'`,
          [otherRentalIds],
        );

        await notifyMany(
          conn,
          otherTenantIds.map((tenantId, i) => ({
            userId: tenantId,
            entityType: "RENTAL",
            type: "RENTAL_REJECTED",
            message:
              "Your rental request has been rejected because another request for the same property has been approved by the landlord.",
            metadata: {
              rental_id: otherRentalIds[i],
            },
          })),
        );
      }

      await conn.commit();
      return res.status(200).json({
        message: "Landlord signed successfully. Agreement is ready for tenant.",
      });
    }

    // TENANT FLOW: same route handles sign/deploy and deposit confirm (when txHash is sent)
    if (userRole === "TENANT") {
      if (
        (rentalWithAgreement.rental_status === "PENDING_DEPOSIT" ||
          rentalWithAgreement.status === "DEPLOYED") &&
        txHash
      ) {
        if (!ethers.isHexString(txHash) || txHash.length !== 66) {
          await conn.rollback();
          return res
            .status(400)
            .json({ message: "Invalid transaction hash format" });
        }

        const expectedContract = (
          contractAddress.rentalContractAddress || ""
        ).toLowerCase();
        const expectedTenant = (
          rentalWithAgreement.tenant_address || ""
        ).toLowerCase();
        const expectedDepositWei = ethers.parseEther(
          String(rentalWithAgreement.security_deposit),
        );

        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt) {
          await conn.rollback();
          return res
            .status(404)
            .json({ message: "Transaction not found or not mined yet" });
        }

        if (receipt.status !== 1) {
          await conn.rollback();
          return res
            .status(400)
            .json({ message: "Transaction failed on chain" });
        }

        if (!receipt.to || receipt.to.toLowerCase() !== expectedContract) {
          await conn.rollback();
          return res.status(400).json({
            message: "Transaction was not sent to the correct contract address",
          });
        }

        const tx = await provider.getTransaction(txHash);
        if (!tx || tx.from.toLowerCase() !== expectedTenant) {
          await conn.rollback();
          return res.status(400).json({
            message: "Transaction details do not match expected values",
          });
        }

        if (tx.value !== expectedDepositWei) {
          await conn.rollback();
          return res.status(400).json({ message: "Deposit value mismatch" });
        }

        const iface = new ethers.Interface([
          "event DepositPaid(uint256 id, uint256 amount)",
        ]);

        let matchedDepositEvent = false;
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== expectedContract) continue;
          try {
            const parsed = iface.parseLog(log);
            if (!parsed || parsed.name !== "DepositPaid") continue;
            if (
              Number(parsed.args.id) ===
                Number(rentalWithAgreement.blockchain_index) &&
              parsed.args.amount === expectedDepositWei
            ) {
              matchedDepositEvent = true;
              break;
            }
          } catch {
            // Ignore non-matching logs
          }
        }

        if (!matchedDepositEvent) {
          await conn.rollback();
          return res.status(400).json({
            message: "Valid DepositPaid event not found for this rental",
          });
        }

        await conn.query(
          `UPDATE rental_agreements
            SET status = 'ACTIVE', updated_at = NOW()
            WHERE id = ? AND status = 'PENDING_DEPOSIT'`,
          [rentalId],
        );

        await conn.query(
          `UPDATE contract_agreements
            SET deposit_tx_hash = ?
            WHERE rental_agreement_id = ?`,
          [txHash, rentalId],
        );

        await notify(conn, {
          userId: rentalWithAgreement.tenant_id,
          entityType: "RENTAL",
          type: "RENTAL_ACTIVATED",
          message:
            "Your deposit payment has been confirmed and rental is active.",
          metadata: { rental_id: rentalId },
        });

        await conn.commit();
        return res
          .status(200)
          .json({ message: "Tenant deposit confirmed and rental activated." });
      }

      if (!signature || !message) {
        await conn.rollback();
        return res
          .status(400)
          .json({ message: "Signature and message are required" });
      }

      const signerAddress = ethers.verifyMessage(message, signature);
      if (signerAddress.toLowerCase() !== req.user.address.toLowerCase()) {
        await conn.rollback();
        return res
          .status(401)
          .json({ message: "Signature verification failed" });
      }

      if (rentalWithAgreement.rental_status !== "APPROVED") {
        await conn.rollback();
        return res.status(400).json({
          message:
            "Rental agreement must be in APPROVED status for tenant sign",
        });
      }

      if (!rentalWithAgreement.landlord_signature) {
        await conn.rollback();
        return res.status(400).json({
          message: "Landlord must sign the agreement before tenant can sign",
        });
      }

      if (!rentalWithAgreement.agreement_ipfs_hash) {
        await conn.rollback();
        return res.status(404).json({
          message: "Agreement not generated yet. Ask landlord to sign.",
        });
      }

      const leaseStartSec = rentalWithAgreement.start_date
        ? Math.floor(new Date(rentalWithAgreement.start_date).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      const { txHash: chainTxHash, agreementIndex } = await storeAgreement(
        rentalWithAgreement.tenant_address,
        rentalWithAgreement.landlord_address,
        rentalWithAgreement.agreement_ipfs_hash,
        signature,
        rentalWithAgreement.landlord_signature,
        leaseStartSec,
        parseInt(rentalWithAgreement.lease_duration),
        ethers.parseEther(rentalWithAgreement.rent_amount.toString()),
        ethers.parseEther(rentalWithAgreement.security_deposit.toString()),
      );

      await conn.query(
        `UPDATE contract_agreements
          SET tenant_signature = ?, status = 'DEPLOYED', blockchain_index = ?, blockchain_tx_hash = ?
          WHERE rental_agreement_id = ?`,
        [signature, agreementIndex, chainTxHash, rentalId],
      );

      await conn.query(
        `UPDATE rental_agreements
          SET status = 'PENDING_DEPOSIT', updated_at = NOW()
          WHERE id = ? AND status = 'APPROVED'`,
        [rentalId],
      );

      await conn.commit();
      return res.status(200).json({
        message:
          "Tenant signed successfully. Agreement deployed and waiting for deposit payment.",
        agreementIndex,
        txHash: chainTxHash,
      });
    }

    await conn.rollback();
    return res.status(403).json({ message: "Invalid role for this action" });
  } catch (err) {
    await conn.rollback();
    console.error("Error signing agreement:", err);
    return res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
};

export const viewAgreement = async (req, res) => {
  const rentalId = req.params.id;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    // Verify that the user has the right to view this agreement
    const [[rental]] = await pool.query(
      `SELECT 1 FROM rental_agreements
        WHERE id = ? AND (
            ( ? = 'TENANT' AND tenant_id = ? ) OR
            ( ? = 'LANDLORD' AND landlord_id = ? )
        )`,
      [rentalId, userRole, userId, userRole, userId],
    );

    if (!rental) {
      return res.status(404).json({ message: "Rental agreement not found" });
    }

    const [[agreement]] = await pool.query(
      `SELECT agreement_ipfs_hash, status, blockchain_index FROM contract_agreements
        WHERE rental_agreement_id = ?`,
      [rentalId],
    );

    if (!agreement) {
      return res
        .status(404)
        .json({ message: "Contract agreement not found for this rental" });
    }

    let ipfsHash = agreement.agreement_ipfs_hash;

    // if the agreement has been deployed to blockchain, we can fetch the IPFS hash from blockchain
    if (agreement.status === "DEPLOYED") {
      const idx = agreement.blockchain_index;
      ipfsHash = await getAgreement(idx);
    }

    // TODO: for testing purpose, remove later
    console.log(
      `Fetching agreement from IPFS with hash, status = ${agreement.status}:`,
      ipfsHash,
    );

    const ipfsUrl = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;

    // suggested by copilot :) adding timeout to prevent hanging if IPFS gateway is not responding,
    // since fetching from IPFS can sometimes be slow or unreliable, we can set a reasonable timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    let response;
    try {
      response = await fetch(ipfsUrl, { signal: controller.signal });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        return res
          .status(504)
          .json({ message: "Timeout while fetching agreement from IPFS" });
      }
      throw error;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      return res.status(502).json({
        message: `Failed to fetch agreement from IPFS (status: ${response.status})`,
      });
    }

    const pdfBuffer = await response.arrayBuffer();
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=agreement.pdf",
    });
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error("Error viewing agreement:", err);
    res.status(500).json({ message: "Failed to view agreement" });
  }
};

export const confirmRentPayment = async (req, res) => {
  const txHash = req.body.txHash;
  const userId = req.user.id;
  const rentalId = req.params.id;

  if (!txHash) {
    return res.status(400).json({ message: "Transaction hash is required" });
  }

  if (!ethers.isHexString(txHash) || txHash.length !== 66) {
    return res.status(400).json({ message: "Invalid transaction hash format" });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Fetch rental + agreement + expected rent for strict validation.
    // Include LEASE_EXPIRED to avoid race with cron status flip that can
    // happen between on-chain payment and backend confirmation.
    const [[rental]] = await conn.query(
      `SELECT
          r.tenant_id,
          r.landlord_id,
          p.rent_amount,
          r.status,
          ca.blockchain_index,
          ca.tenant_address
        FROM rental_agreements r
        JOIN properties p ON p.id = r.property_id
        JOIN contract_agreements ca ON ca.rental_agreement_id = r.id
        WHERE r.id = ? AND r.tenant_id = ?
          AND r.status IN ('ACTIVE', 'LEASE_EXPIRED')`,
      [rentalId, userId],
    );

    if (!rental) {
      await conn.rollback();
      return res.status(404).json({
        message: "Rental agreement not found or not in payable status",
      });
    }

    const expectedContract = (
      contractAddress.rentalContractAddress || ""
    ).toLowerCase();
    const expectedTenant = (rental.tenant_address || "").toLowerCase();
    const expectedRentWei = ethers.parseEther(String(rental.rent_amount));

    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt) {
      await conn.rollback();
      return res
        .status(404)
        .json({ message: "Transaction not found or not mined yet" });
    }

    if (receipt.status !== 1) {
      await conn.rollback();
      return res.status(400).json({ message: "Transaction failed on chain" });
    }

    if (!receipt.to || receipt.to.toLowerCase() !== expectedContract) {
      await conn.rollback();
      return res.status(400).json({
        message: "Transaction was not sent to the correct contract address",
      });
    }

    const tx = await provider.getTransaction(txHash);

    if (!tx) {
      await conn.rollback();
      return res
        .status(404)
        .json({ message: "Transaction details not found for the given hash" });
    }

    if (tx.from.toLowerCase() !== expectedTenant) {
      await conn.rollback();
      return res.status(400).json({
        message: "Transaction details do not match expected values",
      });
    }

    if (tx.value < expectedRentWei || tx.value % expectedRentWei !== 0n) {
      await conn.rollback();
      return res.status(400).json({
        message: "Rent value mismatch",
      });
    }

    const iface = new ethers.Interface([
      "event RentPaid(uint256 id, uint256 amount, uint256 periodsCount, uint256 previousPeriodIndex, uint256 newPeriodIndex, uint256 timestamp)",
    ]);

    let matchedRentEvent = false;
    let periodsPaymentData = null;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== expectedContract) continue;

      try {
        const parsed = iface.parseLog(log);
        if (!parsed || parsed.name !== "RentPaid") continue;

        const eventId = Number(parsed.args.id);
        const eventAmount = parsed.args.amount;
        const eventPeriodsCount = Number(parsed.args.periodsCount);
        const eventPreviousPeriodIndex = Number(
          parsed.args.previousPeriodIndex,
        );
        const eventNewPeriodIndex = Number(parsed.args.newPeriodIndex);
        const eventTimestamp = Number(parsed.args.timestamp);

        const expectedPeriodsFromValue = Number(tx.value / expectedRentWei);

        if (
          eventId === Number(rental.blockchain_index) &&
          eventAmount === tx.value &&
          eventPeriodsCount === expectedPeriodsFromValue
        ) {
          matchedRentEvent = true;
          periodsPaymentData = {
            amountPaidEth: ethers.formatEther(eventAmount),
            periodsCount: eventPeriodsCount,
            previousPeriodIndex: eventPreviousPeriodIndex,
            newPeriodIndex: eventNewPeriodIndex,
            paidTimestamp: eventTimestamp,
            blockNumber: receipt.blockNumber,
          };
          break;
        }
      } catch {
        // Ignore non-matching logs
      }
    }

    if (!matchedRentEvent) {
      await conn.rollback();
      return res.status(400).json({
        message: "Valid RentPaid event not found for this rental",
      });
    }

    await conn.query(
      `INSERT INTO rent_payments (
        rental_id,
        periods_paid,
        amount_paid,
        previous_period_index,
        new_period_index,
        transaction_hash,
        block_number,
        paid_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rentalId,
        periodsPaymentData.periodsCount,
        periodsPaymentData.amountPaidEth,
        periodsPaymentData.previousPeriodIndex,
        periodsPaymentData.newPeriodIndex,
        txHash,
        periodsPaymentData.blockNumber,
        periodsPaymentData.paidTimestamp,
      ],
    );

    await notify(conn, {
      userId: rental.tenant_id,
      entityType: "RENTAL",
      type: "RENT_PAYMENT_CONFIRMED",
      message: `Your rent payment has been confirmed.`,
      metadata: {
        rental_id: rentalId,
        amount_paid: periodsPaymentData.amountPaidEth,
        periods_paid: periodsPaymentData.periodsCount,
      },
    });

    await notify(conn, {
      userId: rental.landlord_id,
      entityType: "RENTAL",
      type: "RENT_PAID",
      message: `Tenant rent payment has been confirmed.`,
      metadata: {
        rental_id: rentalId,
        amount_paid: periodsPaymentData.amountPaidEth,
        periods_paid: periodsPaymentData.periodsCount,
      },
    });

    await conn.commit();

    return res.status(200).json({ message: "Rent payment confirmed" });
  } catch (err) {
    await conn.rollback();
    console.error("Error confirming rent payment:", err);
    return res.status(500).json({ message: "Failed to confirm rent payment" });
  } finally {
    conn.release();
  }
};

/* ================= RATING & REVIEW FLOW ================= */

const calculateTrustScoreDelta = (rating) => {
  const deltas = {
    5: 10, // excellent
    4: 5, // good
    3: 0, // neutral
    2: -5, // poor
    1: -10, // very poor
    0: -15, // terrible
  };
  return deltas[rating] || 0;
};

const updateTrustScore = (currentScore, delta) => {
  return Math.max(0, Math.min(100, currentScore + delta));
};

export const submitRentalRating = async (req, res) => {
  const userId = req.user.id;
  const rentalId = req.params.id;
  const { rating } = req.body;

  // Validate rating is 0-5
  if (
    typeof rating !== "number" ||
    rating < 0 ||
    rating > 5 ||
    !Number.isInteger(rating)
  ) {
    return res
      .status(400)
      .json({ message: "Rating must be an integer between 0 and 5" });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Fetch rental and validate
    const [[rental]] = await conn.query(
      `SELECT r.id, r.tenant_id, r.landlord_id, r.status, r.tenant_reviewed, r.landlord_reviewed, p.id as property_id
        FROM rental_agreements r
        JOIN properties p ON r.property_id = p.id
        WHERE r.id = ? AND (r.tenant_id = ? OR r.landlord_id = ?)`,
      [rentalId, userId, userId],
    );

    if (!rental) {
      await conn.rollback();
      return res.status(404).json({ message: "Rental not found" });
    }

    if (rental.status !== "LEASE_EXPIRED") {
      await conn.rollback();
      return res
        .status(400)
        .json({ message: "Rental must be in LEASE_EXPIRED status to rate" });
    }

    // Check for active disputes
    const [[activeDisputes]] = await conn.query(
      `SELECT COUNT(*) AS count FROM disputes
        WHERE rental_id = ? AND status != 'RESOLVED'`,
      [rentalId],
    );

    if (activeDisputes.count > 0) {
      await conn.rollback();
      return res
        .status(400)
        .json({ message: "Cannot rate while disputes are active" });
    }

    // Determine if user is tenant or landlord
    const isTenant = rental.tenant_id === userId;

    // Check if already reviewed
    const reviewedColumn = isTenant ? "tenant_reviewed" : "landlord_reviewed";
    if (rental[reviewedColumn]) {
      await conn.rollback();
      return res
        .status(400)
        .json({ message: "You have already reviewed this rental" });
    }

    // Get the other party
    const otherUserId = isTenant ? rental.landlord_id : rental.tenant_id;

    // Update trust score of other party
    const [[otherUser]] = await conn.query(
      `SELECT trust_score FROM users WHERE id = ?`,
      [otherUserId],
    );

    const delta = calculateTrustScoreDelta(rating);
    const newTrustScore = updateTrustScore(otherUser.trust_score, delta);

    await conn.query(`UPDATE users SET trust_score = ? WHERE id = ?`, [
      newTrustScore,
      otherUserId,
    ]);

    // Update rental review flag
    await conn.query(
      `UPDATE rental_agreements SET ${reviewedColumn} = TRUE, updated_at = NOW() WHERE id = ?`,
      [rentalId],
    );

    if (isTenant) {
      await conn.query(
        `UPDATE properties
          SET
            rating = ROUND(rating * ratings_count + ?) / (ratings_count + 1), ratings_count = ratings_count + 1
          WHERE id = ?`,
        [rating, rental.property_id],
      );
    }

    // Check if both have reviewed
    const [[updatedRental]] = await conn.query(
      `SELECT tenant_reviewed, landlord_reviewed FROM rental_agreements WHERE id = ?`,
      [rentalId],
    );

    // Notify the other party that they were rated
    await notify(conn, {
      userId: otherUserId,
      entityType: "RENTAL",
      type: "RENTAL_RATED",
      message: `You have been rated ${rating}/5 for rental #${rentalId}. Your trust score changed by ${delta > 0 ? "+" : ""}${delta}.`,
      metadata: {
        rental_id: rentalId,
        rating,
        trust_score_delta: delta,
        new_trust_score: newTrustScore,
      },
    });

    let statusMessage = `Rating submitted. Other party trust score updated by ${delta > 0 ? "+" : ""}${delta}.`;

    // If both have reviewed, update status to REVIEW_COMPLETED
    if (updatedRental.tenant_reviewed && updatedRental.landlord_reviewed) {
      await conn.query(
        `UPDATE rental_agreements SET status = 'REVIEW_COMPLETED' WHERE id = ?`,
        [rentalId],
      );

      statusMessage +=
        " Both parties have reviewed. Rental status updated to REVIEW_COMPLETED.";

      // Notify both parties
      await notify(conn, {
        userId: rental.tenant_id,
        entityType: "RENTAL",
        type: "RENTAL_REVIEW_COMPLETED",
        message: `Both parties have completed rating for rental #${rentalId}. Deposit will be returned shortly.`,
        metadata: {
          rental_id: rentalId,
        },
      });

      await notify(conn, {
        userId: rental.landlord_id,
        entityType: "RENTAL",
        type: "RENTAL_REVIEW_COMPLETED",
        message: `Both parties have completed rating for rental #${rentalId}. Deposit will be returned shortly.`,
        metadata: {
          rental_id: rentalId,
        },
      });
    }

    await conn.commit();

    return res.status(200).json({ message: statusMessage });
  } catch (err) {
    await conn.rollback();
    console.error("Error submitting rental rating:", err);
    return res.status(500).json({ message: "Failed to submit rating" });
  } finally {
    conn.release();
  }
};
