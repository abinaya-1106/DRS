import { ethers } from "ethers";
import { BLOCKCHAIN_CONFIG, RENT_INTERVAL_SECONDS } from "../config/env.js";
import contractAddress from "../config/contractAddress.json" with { type: "json" };
import RentalContractArtifact from "../../../blockchain/artifacts/contracts/RentalContract.sol/RentalContract.json" with { type: "json" };
import DisputesContractArtifact from "../../../blockchain/artifacts/contracts/DisputesContract.sol/DisputesContract.json" with { type: "json" };

// Ensure the contract addresses are set
if (
  !contractAddress.rentalContractAddress ||
  !contractAddress.disputesContractAddress
) {
  throw new Error(
    "Contract addresses not found. Please deploy the contracts and update contractAddress.json",
  );
}

export const provider = new ethers.JsonRpcProvider(BLOCKCHAIN_CONFIG.RPC_URL);
const wallet = new ethers.Wallet(BLOCKCHAIN_CONFIG.PRIVATE_KEY, provider);

const rentalContract = new ethers.Contract(
  contractAddress.rentalContractAddress,
  RentalContractArtifact.abi,
  wallet,
);

// Transaction queue to prevent nonce conflicts
// Ensures only one transaction is processed at a time from this wallet
let transactionQueue = Promise.resolve();
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 1000; // 1 second
let chainTimeSyncQueue = Promise.resolve();

const isTimestampRaceError = (err) => {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("equal to the previous block") ||
    msg.includes("lower than the previous block")
  );
};

/**
 * Keep local Hardhat time aligned with wall clock for accurate rent-due reads.
 * On live chains this is a no-op.
 */
const syncLocalChainTime = async () => {
  chainTimeSyncQueue = chainTimeSyncQueue
    .then(async () => {
      try {
        const network = await provider.getNetwork();
        if (network.chainId !== 31337n) return;

        for (let attempt = 0; attempt < 4; attempt++) {
          const latestBlock = await provider.getBlock("latest");
          const nowSec = Math.floor(Date.now() / 1000);
          const latestTs = Number(latestBlock?.timestamp || 0);
          const targetTs = Math.max(nowSec, latestTs + 1);

          try {
            await provider.send("evm_setNextBlockTimestamp", [targetTs]);
            await provider.send("evm_mine", []);
            return;
          } catch (err) {
            const rawMsg = String(err?.message || "");
            const isTimestampRace = isTimestampRaceError(err);

            if (!isTimestampRace) {
              throw err;
            }

            // Another request likely advanced the chain already.
            if (attempt === 3) return;

            // Best-effort recovery path when another request mines concurrently.
            const prevTsMatch = rawMsg.match(
              /previous block's timestamp\s+(\d+)/i,
            );
            const reportedPrevTs = prevTsMatch ? Number(prevTsMatch[1]) : NaN;
            const freshLatest = await provider.getBlock("latest");
            const latestKnownTs = Number(freshLatest?.timestamp || targetTs);
            const retryBase = Number.isFinite(reportedPrevTs)
              ? Math.max(reportedPrevTs, latestKnownTs)
              : latestKnownTs;

            try {
              await provider.send("evm_setNextBlockTimestamp", [retryBase + 1]);
              await provider.send("evm_mine", []);
              return;
            } catch (retryErr) {
              if (isTimestampRaceError(retryErr)) {
                // Benign race; let loop retry with fresh latest block.
                continue;
              }
              throw retryErr;
            }
          }
        }
      } catch (err) {
        if (isTimestampRaceError(err)) return;

        // Best-effort only; dues can still be read even if sync fails.
        console.warn(
          "[chain-time-sync] Unable to sync local chain time:",
          err.message,
        );
      }
    })
    .catch(() => {
      // Keep queue usable even if a previous sync attempt fails.
    });

  await chainTimeSyncQueue;
};

/**
 * @dev Execute a transaction with automatic nonce management and retry logic
 * Ensures transactions are processed sequentially to avoid nonce conflicts
 */
const executeTransaction = async (txPromise) => {
  // Chain this transaction to the queue
  transactionQueue = transactionQueue.then(async () => {
    let lastError;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const tx = await txPromise();
        const receipt = await tx.wait();
        return receipt;
      } catch (error) {
        lastError = error;

        // Check if it's a nonce error
        if (error.code === "NONCE_EXPIRED" || error.message.includes("nonce")) {
          const delay = BASE_RETRY_DELAY * Math.pow(2, attempt); // Exponential backoff
          console.warn(
            `Nonce error on attempt ${attempt + 1}, retrying in ${delay}ms...`,
            error.message,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));

          // Refresh the wallet to get updated nonce
          const nonce = await provider.getTransactionCount(wallet.address);
          console.log(`Current nonce from provider: ${nonce}`);

          continue;
        }

        // For other errors, throw immediately
        throw error;
      }
    }

    throw lastError || new Error("Transaction failed after max retries");
  });

  return transactionQueue;
};

/**
 * @dev Store rental agreement on the blockchain
 * @param rentInterval - Rent payment interval in seconds (e.g., 60 for 1 minute test, 2592000 for 30 days)
 */
export const storeAgreement = async (
  tenantAddress,
  landlordAddress,
  cid,
  tenantSignature,
  landlordSignature,
  start_date,
  leaseDurationMultiple,
  rentAmount,
  depositAmount,
  rentInterval = RENT_INTERVAL_SECONDS,
) => {
  const receipt = await executeTransaction(async () => {
    return await rentalContract.storeAgreement({
      tenant: tenantAddress,
      landlord: landlordAddress,
      cid: cid,
      tenantSignature: tenantSignature,
      landlordSignature: landlordSignature,
      start_date: start_date, // timestamp in seconds
      leaseDurationMultiple: leaseDurationMultiple,
      rentAmount: rentAmount,
      depositAmount: depositAmount,
      rentInterval: rentInterval, // configurable rent interval in seconds
    });
  });

  let agreementIndex = null;
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = rentalContract.interface.parseLog(log);
      if (parsed?.name === "AgreementCreated") {
        agreementIndex = Number(parsed.args.id);
        break;
      }
    } catch {
      // Ignore logs from other contracts/events
    }
  }

  if (agreementIndex === null || Number.isNaN(agreementIndex)) {
    throw new Error(
      "Agreement deployment succeeded but AgreementCreated event index could not be parsed",
    );
  }

  // Get tx hash from the receipt
  let txHash = receipt.hash;
  if (!txHash) {
    // If hash is not in receipt, we might need to query it
    txHash = receipt.transactionHash;
  }

  return { txHash, agreementIndex };
};

export const closeAgreement = async (index) => {
  const receipt = await executeTransaction(async () => {
    return await rentalContract.closeAgreement(index);
  });

  return receipt.transactionHash;
};

export const setDisputeStatusOnChain = async (index, hasDispute) => {
  const receipt = await executeTransaction(async () => {
    return await rentalContract.setDisputeStatus(index, hasDispute);
  });

  return receipt.transactionHash;
};

export const returnDepositOnChain = async (index) => {
  const receipt = await executeTransaction(async () => {
    return await rentalContract.returnDeposit(index);
  });

  return receipt.transactionHash;
};

export const resolveDisputeWithPayoutOnChain = async (index, tenantWins) => {
  const receipt = await executeTransaction(async () => {
    return await rentalContract.resolveDisputeWithPayout(index, tenantWins);
  });

  return receipt.transactionHash;
};

/**
 * @dev Pay all due rent periods at once
 * @param index - Agreement index
 * @param rentAmount - Total rent amount to send (in Wei)
 */
export const payRent = async (index, rentAmount) => {
  if (!rentAmount || rentAmount <= 0n) {
    throw new Error("Rent amount must be greater than 0");
  }

  const receipt = await executeTransaction(async () => {
    return await rentalContract.payRent(index, {
      value: rentAmount, // Send the rent amount as transaction value
    });
  });

  return receipt.transactionHash;
};

/**
 * @dev Get current rent dues for an agreement
 * Used to check if tenant has unpaid rent
 * Returns: { duePeriodsCount, dueAmount }
 */
export const getRentDues = async (index) => {
  await syncLocalChainTime();

  const [duePeriodsCount, dueAmount] = await rentalContract.getRentDues(index);

  return {
    duePeriodsCount: Number(duePeriodsCount),
    dueAmount: dueAmount.toString(),
  };
};

/**
 * @dev Get last payment information for dispute resolution
 * Returns: { lastPaidTimestamp, lastPaidPeriodIndex }
 */
export const getLastPaymentInfo = async (index) => {
  const [lastTimestamp, lastPeriodIndex] =
    await rentalContract.getLastPaymentInfo(index);

  return {
    lastPaidTimestamp: Number(lastTimestamp),
    lastPaidPeriodIndex: Number(lastPeriodIndex),
  };
};

/**
 * @dev Get full agreement details for dispute resolution
 * Similar to disputes system - retrieve data from contract in case of conflicts
 */
export const getFullAgreement = async (index) => {
  const details = await rentalContract.getFullAgreement(index);

  return {
    tenant: details[0],
    landlord: details[1],
    rentAmount: details[2].toString(),
    rentInterval: Number(details[3]),
    startDate: Number(details[4]),
    lastPaidTimestamp: Number(details[5]),
    lastPaidPeriodIndex: Number(details[6]),
    active: details[7],
    depositPaid: details[8],
  };
};

export const getAgreement = async (index) => {
  const cid = await rentalContract.getAgreement(index);
  return cid;
};

export const getAgreementsCount = async () => {
  const count = await rentalContract.getAgreementsCount();
  return Number(count);
};

export const getAgreementIndexFromTxHash = async (txHash) => {
  if (!txHash) return null;

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return null;

  for (const log of receipt.logs ?? []) {
    try {
      const parsed = rentalContract.interface.parseLog(log);
      if (parsed?.name === "AgreementCreated") {
        const id = Number(parsed.args.id);
        return Number.isNaN(id) ? null : id;
      }
    } catch {
      // Ignore logs from other contracts/events
    }
  }

  return null;
};

const disputesContract = new ethers.Contract(
  contractAddress.disputesContractAddress,
  DisputesContractArtifact.abi,
  wallet,
);

export const storeDisputeOnChain = async (disputeId) => {
  const receipt = await executeTransaction(async () => {
    return await disputesContract.storeDispute(disputeId);
  });

  return receipt.transactionHash;
};

export const voteOnDisputeOnChain = async (
  disputeId,
  voteForTenant,
  voterAddress,
) => {
  const receipt = await executeTransaction(async () => {
    return await disputesContract.voteOnDispute(
      disputeId,
      voteForTenant,
      voterAddress,
    );
  });

  return receipt.transactionHash;
};

export const getDisputeVotesOnChain = async (disputeId) => {
  const [tenantVotes, landlordVotes] =
    await disputesContract.getDisputeVotes(disputeId);

  return {
    tenantVotes: Number(tenantVotes),
    landlordVotes: Number(landlordVotes),
  };
};
