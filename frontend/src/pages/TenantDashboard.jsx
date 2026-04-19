import { RENTAL_CONTRACT_ADDRESS } from "../config/contractAddress";
import { ethers } from "ethers";
import { useEffect, useState, useCallback } from "react";
import { authFetch } from "../utils/authFetch";
import { useNavigate } from "react-router-dom";
import "../styles/tenantDashboard.css";

// ─── Lightbox ────────────────────────────────────────────────────────────────
const Lightbox = ({ images, startIndex, onClose }) => {
  const [current, setCurrent] = useState(startIndex);

  const prev = (e) => {
    e.stopPropagation();
    setCurrent((i) => (i - 1 + images.length) % images.length);
  };
  const next = (e) => {
    e.stopPropagation();
    setCurrent((i) => (i + 1) % images.length);
  };

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "ArrowLeft")
        setCurrent((i) => (i - 1 + images.length) % images.length);
      if (e.key === "ArrowRight") setCurrent((i) => (i + 1) % images.length);
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [images.length, onClose]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}>
        ✕
      </button>
      {images.length > 1 && (
        <button className="lightbox-arrow lightbox-arrow--prev" onClick={prev}>
          &#8249;
        </button>
      )}
      <div className="lightbox-img-wrap" onClick={(e) => e.stopPropagation()}>
        <img
          src={images[current].image_url}
          alt={`photo-${current}`}
          className="lightbox-img"
        />
        <div className="lightbox-counter">
          {current + 1} / {images.length}
        </div>
      </div>
      {images.length > 1 && (
        <button className="lightbox-arrow lightbox-arrow--next" onClick={next}>
          &#8250;
        </button>
      )}
    </div>
  );
};

// ─── Raise Dispute Modal ──────────────────────────────────────────────────────
const RaiseDisputeModal = ({ rental, onClose, onSubmit }) => {
  const [description, setDescription] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!description.trim()) {
      alert("Please provide a description.");
      return;
    }
    setSubmitting(true);
    await onSubmit({
      rentalId: rental.id,
      description,
      evidence_url: evidenceUrl || null,
    });
    setSubmitting(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="raise-dispute-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>
          ✕
        </button>
        <div className="raise-dispute-header">
          <span>⚖️</span>
          <div>
            <h3>Raise a Dispute</h3>
            <p className="raise-dispute-subtitle">
              {rental.property_title} — {rental.property_location}
            </p>
          </div>
        </div>
        <form className="raise-dispute-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Description *</label>
            <textarea
              placeholder="Describe the issue in detail..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              required
            />
          </div>
          <div className="form-group">
            <label>
              Evidence URL{" "}
              <span style={{ fontWeight: 400, color: "#9ca3af" }}>
                (optional)
              </span>
            </label>
            <input
              type="url"
              placeholder="https://..."
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
            />
          </div>
          <div className="raise-dispute-actions">
            <button
              type="submit"
              className="raise-submit-btn"
              disabled={submitting}
            >
              {submitting ? "⏳ Submitting..." : "⚖️ Submit Dispute"}
            </button>
            <button type="button" className="cancel-btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Pay Rent Modal ───────────────────────────────────────────────────────────
// Shown when tenant clicks "Pay Rent". Fetches dues from backend, lets tenant
// review current dues, then executes the on-chain payRent(index) call and
// confirms with the backend.
const PayRentModal = ({ rental, walletAddress, onClose, onSuccess }) => {
  const [dues, setDues] = useState(null);
  const [liveDuePeriods, setLiveDuePeriods] = useState(null);
  const [leaseState, setLeaseState] = useState("active");
  const [rentPerPeriodWei, setRentPerPeriodWei] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState(null);

  const shortenAddress = (addr) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  // Derived values: separate current rent from overdue
  const duePeriodsCount = dues ? Number(dues.duePeriodsCount || 0) : 0;
  // Reconcile backend and wallet-side chain reads; use the latest non-stale value.
  const effectiveDuePeriods = Math.max(
    0,
    duePeriodsCount,
    Number(liveDuePeriods ?? 0),
  );
  const overduePeriods = Math.max(0, effectiveDuePeriods - 1);
  const hasOverdue = overduePeriods > 0;
  const hasAnyDue = effectiveDuePeriods > 0;

  const getLeaseState = (agreement, nowSec) => {
    const start = Number(agreement.start_date);
    const interval = Number(agreement.rentInterval);
    const leaseDurationMultiple = Number(agreement.leaseDurationMultiple);

    if (interval <= 0) return "active";
    if (nowSec < start) return "not_started";

    const leaseEnd = start + leaseDurationMultiple * interval;
    if (nowSec >= leaseEnd) return "completed";

    return "active";
  };

  const syncLocalChainTime = useCallback(async (provider) => {
    try {
      const network = await provider.getNetwork();
      if (network.chainId !== 31337n) return;

      const latestBlock = await provider.getBlock("latest");
      const nowSec = Math.floor(Date.now() / 1000);
      const latestTs = Number(latestBlock?.timestamp || 0);
      const targetTs = Math.max(nowSec, latestTs + 1);

      try {
        await provider.send("evm_setNextBlockTimestamp", [targetTs]);
        await provider.send("evm_mine", []);
      } catch (err) {
        const rawMsg = String(err?.message || "");
        const msg = rawMsg.toLowerCase();
        const isTimestampRace =
          msg.includes("equal to the previous block") ||
          msg.includes("lower than the previous block");

        if (!isTimestampRace) throw err;

        const prevTsMatch = rawMsg.match(/previous block's timestamp\s+(\d+)/i);
        const reportedPrevTs = prevTsMatch ? Number(prevTsMatch[1]) : NaN;
        const freshLatest = await provider.getBlock("latest");
        const latestKnownTs = Number(freshLatest?.timestamp || targetTs);
        const retryBase = Number.isFinite(reportedPrevTs)
          ? Math.max(reportedPrevTs, latestKnownTs)
          : latestKnownTs;
        const retryTs = retryBase + 1;
        await provider.send("evm_setNextBlockTimestamp", [retryTs]);
        await provider.send("evm_mine", []);
      }
    } catch {
      // Best-effort; chain may reject debug RPC methods on non-local setups.
    }
  }, []);

  const readLiveDuesFromChain = useCallback(
    async (blockchainIndex) => {
      if (!window.ethereum) return;

      const provider = new ethers.BrowserProvider(window.ethereum);
      await syncLocalChainTime(provider);

      const contractABI = [
        "function agreements(uint256) view returns (address tenant, address landlord, string cid, bytes tenantSignature, bytes landlordSignature, uint256 start_date, uint256 leaseDurationMultiple, uint256 rentAmount, uint256 depositAmount, uint256 rentInterval, uint256 lastPaidTimestamp, uint256 lastPaidPeriodIndex, bool depositPaid, bool active, bool dispute)",
        "function getRentDues(uint256 index) view returns (uint256 duePeriodsCount, uint256 dueAmount)",
        "function getAgreementsCount() view returns (uint256)",
      ];

      const contract = new ethers.Contract(
        RENTAL_CONTRACT_ADDRESS,
        contractABI,
        provider,
      );

      const agreementsCount = await contract.getAgreementsCount();
      if (BigInt(blockchainIndex) >= BigInt(agreementsCount)) {
        // situation: backend stored out-of-range index or contract not synced yet
        setLiveDuePeriods(0);
        setLeaseState("not_started");
        setRentPerPeriodWei(0n);
        return;
      }

      let agreement;
      try {
        agreement = await contract.agreements(blockchainIndex);
      } catch (err) {
        console.error("Error reading chain agreement", err);
        setLiveDuePeriods(0);
        setLeaseState("not_started");
        setRentPerPeriodWei(0n);
        return;
      }

      const latestBlock = await provider.getBlock("latest");
      const nowSec = Number(
        latestBlock?.timestamp ?? Math.floor(Date.now() / 1000),
      );
      const duesOnChain = await contract.getRentDues(blockchainIndex);
      const duePeriods = Number(duesOnChain.duePeriodsCount || 0n);
      const state = getLeaseState(agreement, nowSec);

      setLiveDuePeriods(duePeriods);
      setLeaseState(state);
      setRentPerPeriodWei(agreement.rentAmount);
    },
    [syncLocalChainTime],
  );

  const refreshDues = useCallback(async () => {
    const data = await authFetch(`/rentals/${rental.id}/rent/dues`);
    setDues(data);
    return data;
  }, [rental.id]);

  useEffect(() => {
    const fetchDues = async () => {
      try {
        setLoading(true);
        setError(null);
        const fetched = await refreshDues();
        if (
          fetched?.blockchainIndex !== null &&
          fetched?.blockchainIndex !== undefined
        ) {
          await readLiveDuesFromChain(Number(fetched.blockchainIndex));
        }
      } catch (err) {
        setError(err.message || "Failed to fetch rent dues");
      } finally {
        setLoading(false);
      }
    };

    fetchDues();

    // Keep dues fresh while modal is open so interval rollover is reflected.
    const intervalId = setInterval(async () => {
      try {
        const refreshed = await refreshDues();
        if (
          refreshed?.blockchainIndex !== null &&
          refreshed?.blockchainIndex !== undefined
        ) {
          await readLiveDuesFromChain(Number(refreshed.blockchainIndex));
        }
      } catch {
        // Best-effort background refresh; surfaced on explicit pay attempt.
      }
    }, 10000);

    return () => clearInterval(intervalId);
  }, [rental.id, refreshDues, readLiveDuesFromChain]);

  const handlePay = async () => {
    if (!walletAddress) {
      alert("Connect your MetaMask wallet.");
      return;
    }
    setPaying(true);
    setError(null);
    try {
      let provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (network.chainId !== 31337n) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x7a69" }],
          });
        } catch (switchErr) {
          if (switchErr?.code === 4902) {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: "0x7a69",
                  chainName: "Hardhat Local",
                  nativeCurrency: {
                    name: "Ethereum",
                    symbol: "ETH",
                    decimals: 18,
                  },
                  rpcUrls: ["http://127.0.0.1:8545"],
                },
              ],
            });
            await window.ethereum.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: "0x7a69" }],
            });
          } else throw switchErr;
        }
        provider = new ethers.BrowserProvider(window.ethereum);
        const switched = await provider.getNetwork();
        if (switched.chainId !== 31337n)
          throw new Error(
            "Wrong network. Switch MetaMask to Hardhat Local (31337).",
          );
      }

      await syncLocalChainTime(provider);

      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      if (signerAddress.toLowerCase() !== walletAddress.toLowerCase())
        throw new Error(
          `Wallet mismatch. Expected ${shortenAddress(walletAddress)}.`,
        );

      const contractABI = [
        "function payRent(uint256 index) payable",
        "function getRentDues(uint256 index) view returns (uint256 duePeriodsCount, uint256 dueAmount)",
        "function agreements(uint256) view returns (address tenant, address landlord, string cid, bytes tenantSignature, bytes landlordSignature, uint256 start_date, uint256 leaseDurationMultiple, uint256 rentAmount, uint256 depositAmount, uint256 rentInterval, uint256 lastPaidTimestamp, uint256 lastPaidPeriodIndex, bool depositPaid, bool active, bool dispute)",
        "function getAgreementsCount() view returns (uint256)",
      ];
      const contract = new ethers.Contract(
        RENTAL_CONTRACT_ADDRESS,
        contractABI,
        signer,
      );

      const blockchainIndex = dues.blockchainIndex;
      if (blockchainIndex === null || blockchainIndex === undefined)
        throw new Error("Blockchain index not found.");

      // Read on-chain agreement directly. Let ethers throw the raw revert if invalid index / require fails.
      const agreement = await contract.agreements(blockchainIndex);
      if (!agreement.depositPaid)
        throw new Error("Security deposit must be paid before paying rent.");
      if (!agreement.active)
        throw new Error("This rental agreement is no longer active.");

      const latestBlock = await provider.getBlock("latest");
      const now = BigInt(
        latestBlock?.timestamp ?? Math.floor(Date.now() / 1000),
      );
      const leaseEnd =
        agreement.start_date +
        agreement.leaseDurationMultiple * agreement.rentInterval;
      if (now >= leaseEnd)
        throw new Error("Lease has expired. Rent payment is not allowed.");

      // Retry logic for handling race condition with block timing
      const MAX_RETRIES = 3;
      let lastError;
      let tx;
      let latestDuePeriods;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // Fetch latest dues just before sending transaction
          await syncLocalChainTime(provider);
          const duesOnChain = await contract.getRentDues(blockchainIndex);
          latestDuePeriods = Number(duesOnChain.duePeriodsCount);
          const totalWei = duesOnChain.dueAmount;
          if (latestDuePeriods <= 0 || totalWei <= 0n) {
            throw new Error("No rent is currently due.");
          }

          const totalEth = ethers.formatEther(totalWei);

          const walletBalanceWei = await provider.getBalance(signerAddress);
          if (walletBalanceWei < totalWei)
            throw new Error(
              `Insufficient balance. Need ${totalEth} ETH but wallet only has ${ethers.formatEther(walletBalanceWei)} ETH.`,
            );

          if (attempt === 1) {
            alert(
              `Paying ${latestDuePeriods} due period${latestDuePeriods > 1 ? "s" : ""} = ${totalEth} ETH.\nTransaction sent. Waiting for confirmation...`,
            );
          }

          tx = await contract.payRent(blockchainIndex, { value: totalWei });
          await tx.wait();
          break; // Success, exit retry loop
        } catch (err) {
          lastError = err;

          // Check if it's the "Incorrect rent amount" error caused by block timing
          const isIncorrectAmountError =
            err?.reason?.includes("Incorrect rent amount") ||
            err?.message?.includes("Incorrect rent amount");

          if (isIncorrectAmountError && attempt < MAX_RETRIES) {
            console.warn(
              `Block timing race condition detected. Retrying... (Attempt ${attempt}/${MAX_RETRIES})`,
            );
            // Wait a bit before retrying to let block time settle
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue; // Retry
          }

          // For other errors, throw immediately without retrying
          throw err;
        }
      }

      if (!tx) {
        throw new Error("Transaction failed after multiple attempts. Please try again.");
      }

      await authFetch(`/rentals/${rental.id}/rent/confirm`, {
        method: "POST",
        body: JSON.stringify({ txHash: tx.hash }),
      });

      alert(
        `🎉 Rent paid for ${latestDuePeriods} period${latestDuePeriods > 1 ? "s" : ""}!`,
      );
      onSuccess();
    } catch (err) {
      if (err.code === 4001) setError("Transaction rejected in MetaMask.");
      else if (err?.code === "INSUFFICIENT_FUNDS")
        setError("Insufficient funds on Hardhat Local.");
      else setError("Transaction failed. Please try again.");
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="raise-dispute-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>
          ✕
        </button>
        <div className="raise-dispute-header">
          <span>💰</span>
          <div>
            <h3>Pay Rent</h3>
            <p className="raise-dispute-subtitle">
              {rental.property_title} — {rental.property_location}
            </p>
          </div>
        </div>

        {loading && <p style={{ padding: "1rem" }}>⏳ Fetching rent dues...</p>}

        {!loading && error && (
          <div style={{ padding: "1rem" }}>
            <p style={{ color: "#ef4444" }}>❌ {error}</p>
            <button className="cancel-btn" onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {!loading && !error && dues && (
          <div style={{ padding: "1rem" }}>
            {/* ── Dues summary ── */}
            <div className="financial-info" style={{ marginBottom: "1rem" }}>
              <p>
                <b>Rent per period:</b>{" "}
                {ethers.formatEther(
                  rentPerPeriodWei ??
                    ethers.parseEther(String(dues.rentAmount || "0")),
                )}{" "}
                ETH
              </p>

              {hasAnyDue ? (
                <p style={{ color: "#3b82f6" }}>
                  📅 <b>Current period's rent:</b>{" "}
                  {ethers.formatEther(
                    rentPerPeriodWei ??
                      ethers.parseEther(String(dues.rentAmount || "0")),
                  )}{" "}
                  ETH
                </p>
              ) : (
                <p style={{ color: "#22c55e" }}>
                  {leaseState === "completed"
                    ? "✅ Lease completed. No further rent is due."
                    : "✅ No dues right now. Next rent period has not started yet."}
                </p>
              )}

              {/* Overdue shown only if duePeriodsCount > 1 */}
              {hasOverdue ? (
                <p style={{ color: "#f59e0b" }}>
                  ⚠️ <b>Overdue periods:</b> {overduePeriods} ×{" "}
                  {ethers.formatEther(
                    rentPerPeriodWei ??
                      ethers.parseEther(String(dues.rentAmount || "0")),
                  )}{" "}
                  ETH ={" "}
                  {ethers.formatEther(
                    (rentPerPeriodWei ??
                      ethers.parseEther(String(dues.rentAmount || "0"))) *
                      BigInt(overduePeriods),
                  )}{" "}
                  ETH
                </p>
              ) : (
                <p style={{ color: "#22c55e" }}>✅ No overdue periods.</p>
              )}
            </div>

            {/* ── Period selector ── */}
            <div className="form-group" style={{ marginBottom: "1rem" }}>
              <label>
                <b>Periods to pay now</b>
                {hasOverdue && (
                  <span
                    style={{
                      fontWeight: 400,
                      color: "#9ca3af",
                      marginLeft: "0.4rem",
                    }}
                  >
                    ({overduePeriods} overdue + 1 current)
                  </span>
                )}
              </label>
              <input
                type="number"
                value={effectiveDuePeriods}
                readOnly
                style={{ marginTop: "0.3rem" }}
              />
              {/* Breakdown of what the selected count means */}
              <p
                style={{
                  fontSize: "0.8rem",
                  color: "#9ca3af",
                  marginTop: "0.3rem",
                }}
              >
                {effectiveDuePeriods === 0
                  ? "No rent due right now."
                  : effectiveDuePeriods === 1
                    ? "Paying current period only."
                    : `Paying current period + ${effectiveDuePeriods - 1} overdue period${effectiveDuePeriods - 1 > 1 ? "s" : ""}.`}
              </p>
            </div>

            {/* ── Total ── */}
            <p style={{ marginBottom: "1rem" }}>
              <b>Total to pay:</b>{" "}
              <span style={{ color: "#3b82f6", fontWeight: 600 }}>
                {ethers.formatEther(
                  (rentPerPeriodWei ??
                    ethers.parseEther(String(dues.rentAmount || "0"))) *
                    BigInt(effectiveDuePeriods),
                )}{" "}
                ETH
              </span>
            </p>

            {error && (
              <p style={{ color: "#ef4444", marginBottom: "0.8rem" }}>
                ❌ {error}
              </p>
            )}

            <div className="raise-dispute-actions">
              <button
                className="raise-submit-btn"
                onClick={handlePay}
                disabled={paying || !hasAnyDue}
              >
                {paying
                  ? "⏳ Processing..."
                  : hasAnyDue
                    ? `💰 Pay ${effectiveDuePeriods} Period${effectiveDuePeriods > 1 ? "s" : ""}`
                    : "✅ No Dues"}
              </button>
              <button
                type="button"
                className="cancel-btn"
                onClick={onClose}
                disabled={paying}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const TenantDashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [properties, setProperties] = useState([]);
  const [requestedProperties, setRequestedProperties] = useState([]);
  const [approvedProperties, setApprovedProperties] = useState([]);
  const [rejectedProperties, setRejectedProperties] = useState([]);
  const [activeProperties, setActiveProperties] = useState([]);
  const [leaseExpiredProperties, setLeaseExpiredProperties] = useState([]);
  const [reviewCompletedProperties, setReviewCompletedProperties] = useState(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [walletAddress, setWalletAddress] = useState(null);
  const [rentedDuration, setRentedDuration] = useState(12);
  const [requestedPropertyIds, setRequestedPropertyIds] = useState(new Set());
  const [rejectedPropertyIds, setRejectedPropertyIds] = useState(new Set());
  const [activePropertyIds, setActivePropertyIds] = useState(new Set());
  const [actionLoading, setActionLoading] = useState({});
  const [agreementLoading, setAgreementLoading] = useState(false);
  const [profileFormData, setProfileFormData] = useState({
    username: "",
    phone: "",
  });
  const [lightbox, setLightbox] = useState(null);
  const [raiseDisputeFor, setRaiseDisputeFor] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [reviewModal, setReviewModal] = useState(false);
  const [reviewRental, setReviewRental] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  // ── Pay Rent Modal ──
  const [payRentFor, setPayRentFor] = useState(null); // rental object or null

  const formatDate = (val) => {
    if (!val) return "N/A";
    const d = new Date(val);
    return isNaN(d.getTime()) ? "N/A" : d.toLocaleDateString();
  };
  const formatFurnishing = (val) => (val ? val.replace(/_/g, " ") : "N/A");

  const handleAccountsChanged = useCallback((a) => {
    setWalletAddress(a.length === 0 ? null : a[0]);
  }, []);

  useEffect(() => {
    fetchUserProfile();
    fetchAllProperties();
    fetchMyRentals();
    loadWalletAddress();
    if (window.ethereum)
      window.ethereum.on("accountsChanged", handleAccountsChanged);

    return () => {
      if (window.ethereum?.removeListener)
        window.ethereum.removeListener(
          "accountsChanged",
          handleAccountsChanged,
        );
    };
  }, [navigate, handleAccountsChanged]);

  // Polling for notifications every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchNotifications();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, []);

  const loadWalletAddress = async () => {
    if (window.ethereum) {
      const a = await window.ethereum.request({ method: "eth_accounts" });
      if (a.length > 0) setWalletAddress(a[0]);
    }
  };

  const shortenAddress = (addr) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  const fetchUserProfile = async () => {
    try {
      const d = await authFetch("/auth/me");
      setUser(d.user);
      setProfileFormData({ username: d.user.username, phone: d.user.phone });
      sessionStorage.setItem("user", JSON.stringify(d.user));
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAllProperties = async () => {
    try {
      setLoading(true);
      const d = await authFetch("/properties/");
      setProperties(d.properties || []);
    } catch {
      setProperties([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchMyRentals = async () => {
    try {
      const d = await authFetch("/rentals/my");
      const withDetails = await Promise.all(
        (d.rentals || []).map(async (r) => {
          try {
            const det = await authFetch(`/rentals/${r.id}`);
            return det.rental?.property_title ? det.rental : r;
          } catch {
            return r;
          }
        }),
      );
      const pending = withDetails.filter((r) => r.status === "PENDING");
      const approved = withDetails.filter((r) => r.status === "APPROVED");
      const rejected = withDetails.filter((r) => r.status === "REJECTED");
      const uniqueRejected = rejected.filter(
        (r, index, arr) =>
          arr.findIndex((r2) => r2.property_id === r.property_id) === index,
      );
      const active = withDetails.filter(
        (r) => r.status === "ACTIVE" || r.status === "PENDING_DEPOSIT",
      );
      const leaseExpired = withDetails.filter(
        (r) => r.status === "LEASE_EXPIRED",
      );
      const reviewCompleted = withDetails.filter(
        (r) => r.status === "REVIEW_COMPLETED",
      );
      setRequestedProperties(pending);
      setApprovedProperties(approved);
      setRejectedProperties(uniqueRejected);
      setActiveProperties(active);
      setLeaseExpiredProperties(leaseExpired);
      setReviewCompletedProperties(reviewCompleted);
      setRequestedPropertyIds(
        new Set([...pending, ...approved].map((r) => r.property_id)),
      );
      setRejectedPropertyIds(new Set(uniqueRejected.map((r) => r.property_id)));
      setActivePropertyIds(new Set(active.map((r) => r.property_id)));
    } catch {
      setRequestedProperties([]);
      setApprovedProperties([]);
      setRejectedProperties([]);
      setActiveProperties([]);
      setLeaseExpiredProperties([]);
      setReviewCompletedProperties([]);
      setRequestedPropertyIds(new Set());
      setRejectedPropertyIds(new Set());
      setActivePropertyIds(new Set());
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("role");
    sessionStorage.removeItem("user");
    navigate("/");
  };

  const handleProfileChange = (e) =>
    setProfileFormData({ ...profileFormData, [e.target.name]: e.target.value });

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    try {
      await authFetch("/users/edit", {
        method: "PUT",
        body: JSON.stringify(profileFormData),
      });
      alert("Profile updated!");
      setIsEditingProfile(false);
      fetchUserProfile();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRequestProperty = async (propertyId) => {
    const duration = Number(rentedDuration);
    if (!Number.isInteger(duration) || duration <= 0) {
      alert("Please enter a valid lease duration.");
      return;
    }
    try {
      await authFetch("/rentals/apply", {
        method: "POST",
        body: JSON.stringify({ propertyId, lease_duration: duration }),
      });
      alert("Rental request sent!");
      setSelectedProperty(null);
      setRentedDuration(12);
      fetchMyRentals();
      fetchAllProperties();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRequestAgain = async (propertyId) => {
    const duration = Number(rentedDuration);
    if (!Number.isInteger(duration) || duration <= 0) {
      alert("Please enter a valid lease duration.");
      return;
    }
    try {
      await authFetch("/rentals/apply", {
        method: "POST",
        body: JSON.stringify({ propertyId, lease_duration: duration }),
      });
      alert("New rental request sent!");
      setSelectedProperty(null);
      setRentedDuration(12);
      fetchMyRentals();
      fetchAllProperties();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCancelRequest = async (rentalId) => {
    if (!window.confirm("Cancel this rental request?")) return;
    try {
      await authFetch(`/rentals/${rentalId}/cancel`, {
        method: "DELETE",
      });
      alert("Rental request cancelled.");
      setSelectedProperty(null);
      fetchMyRentals();
      fetchAllProperties();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleViewAgreement = async (rentalId) => {
    setAgreementLoading(true);
    try {
      const BASE_URL =
        import.meta.env.VITE_API_URL || "http://localhost:4000/api";
      const token = sessionStorage.getItem("token");
      const res = await fetch(
        `${BASE_URL}/rentals/${rentalId}/agreement/view`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        const contentType = res.headers.get("content-type") || "";
        let errorMsg = `Failed to fetch agreement (${res.status})`;
        if (contentType.includes("application/json")) {
          const err = await res.json();
          errorMsg = err.message || errorMsg;
        }
        throw new Error(errorMsg);
      }
      const blob = await res.blob();
      if (blob.type && !blob.type.includes("pdf"))
        throw new Error(`Unexpected response type: ${blob.type}`);
      const blobUrl = URL.createObjectURL(blob);
      const win = window.open(blobUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      if (!win) alert("Popup was blocked. Please allow popups for this site.");
    } catch (err) {
      alert("Could not load agreement: " + err.message);
    } finally {
      setAgreementLoading(false);
    }
  };
  const handleDepositWorkflow = async (rentalId, rentalDetails) => {
    if (!walletAddress) {
      alert("Connect your MetaMask wallet to sign and pay deposit.");
      return;
    }
    setActionLoading((prev) => ({ ...prev, [`tenant_${rentalId}`]: true }));
    try {
      let deployedAgreementIndex = null;
      if (rentalDetails.status === "APPROVED") {
        const message = [
          "RENTAL AGREEMENT SIGNATURE",
          "----------------------------",
          `Property: ${rentalDetails?.property_title || "N/A"}`,
          `Location: ${rentalDetails?.property_location || "N/A"}`,
          `Lease: ${rentalDetails?.lease_duration || "N/A"} minutes`,
          `Rent: Rs. ${rentalDetails?.rent_amount || "N/A"}`,
          `Deposit: Rs. ${rentalDetails?.security_deposit || "N/A"}`,
          `Role: Tenant`,
          `Date: ${new Date().toLocaleDateString()}`,
        ].join("\n");

        const signature = await window.ethereum.request({
          method: "personal_sign",
          params: [message, walletAddress],
        });

        const signRes = await authFetch(
          `/rentals/${rentalId}/agreement/workflow`,
          {
            method: "PATCH",
            body: JSON.stringify({ signature, message }),
          },
        );
        deployedAgreementIndex = signRes?.agreementIndex ?? null;

        alert("✅ Agreement signed & deployed! Now paying security deposit...");
      }

      let provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (network.chainId !== 31337n) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x7a69" }],
          });
        } catch (switchErr) {
          if (switchErr?.code === 4902) {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: "0x7a69",
                  chainName: "Hardhat Local",
                  nativeCurrency: {
                    name: "Ethereum",
                    symbol: "ETH",
                    decimals: 18,
                  },
                  rpcUrls: ["http://127.0.0.1:8545"],
                },
              ],
            });
            await window.ethereum.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: "0x7a69" }],
            });
          } else throw switchErr;
        }
        provider = new ethers.BrowserProvider(window.ethereum);
        const switched = await provider.getNetwork();
        if (switched.chainId !== 31337n)
          throw new Error(
            "Wrong network. Switch MetaMask to Hardhat Local (31337).",
          );
      }

      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      if (signerAddress.toLowerCase() !== walletAddress.toLowerCase())
        throw new Error(
          `Wallet mismatch. Expected ${shortenAddress(signerAddress)}.`,
        );

      const contractABI = [
        "function payDeposit(uint256 index) payable",
        "function getAgreementsCount() view returns (uint256)",
      ];
      const contract = new ethers.Contract(
        RENTAL_CONTRACT_ADDRESS,
        contractABI,
        signer,
      );

      let updatedRental = await authFetch(`/rentals/${rentalId}`);
      let blockchainIndex =
        deployedAgreementIndex ?? updatedRental.rental?.blockchain_index;

      if (blockchainIndex === null || blockchainIndex === undefined)
        throw new Error("Blockchain index not found after deployment.");

      blockchainIndex = Number(blockchainIndex);
      if (Number.isNaN(blockchainIndex)) {
        throw new Error("Invalid blockchain index for this agreement.");
      }

      const pickUsableIndex = async (preferredIndex) => {
        const count = await contract.getAgreementsCount();
        if (BigInt(preferredIndex) < count) return preferredIndex;

        await new Promise((resolve) => setTimeout(resolve, 900));
        const refreshed = await authFetch(`/rentals/${rentalId}`);
        const refreshedIndex = Number(refreshed.rental?.blockchain_index);
        if (!Number.isNaN(refreshedIndex) && BigInt(refreshedIndex) < count) {
          updatedRental = refreshed;
          return refreshedIndex;
        }

        // Do not hard-fail here; backend may still have correct index while chain is catching up.
        return preferredIndex;
      };

      blockchainIndex = await pickUsableIndex(blockchainIndex);

      const depositEth =
        updatedRental.rental?.security_deposit ??
        rentalDetails?.security_deposit;
      if (depositEth === null || depositEth === undefined) {
        throw new Error("Security deposit amount not found for this rental.");
      }
      const depositAmountWei = ethers.parseEther(String(depositEth));
      if (depositAmountWei <= 0n) {
        throw new Error("Invalid security deposit amount.");
      }

      const walletBalanceWei = await provider.getBalance(signerAddress);
      if (walletBalanceWei < depositAmountWei)
        throw new Error(
          `Insufficient balance. Need ${ethers.formatEther(depositAmountWei)} ETH but wallet only has ${ethers.formatEther(walletBalanceWei)} ETH.`,
        );

      alert(
        `Paying security deposit of ${ethers.formatEther(depositAmountWei)} ETH. Please confirm in MetaMask.`,
      );

      let tx;
      try {
        tx = await contract.payDeposit(blockchainIndex, {
          value: depositAmountWei,
        });
      } catch (payErr) {
        if (payErr?.code !== "CALL_EXCEPTION") throw payErr;

        const latestRental = await authFetch(`/rentals/${rentalId}`);
        const latestIndex = Number(latestRental.rental?.blockchain_index);
        if (Number.isNaN(latestIndex) || latestIndex === blockchainIndex) {
          throw payErr;
        }

        blockchainIndex = await pickUsableIndex(latestIndex);
        tx = await contract.payDeposit(blockchainIndex, {
          value: depositAmountWei,
        });
      }
      alert("Transaction sent. Waiting for confirmation...");
      await tx.wait();

      await authFetch(`/rentals/${rentalId}/agreement/workflow`, {
        method: "PATCH",
        body: JSON.stringify({ txHash: tx.hash }),
      });

      alert("🎉 Deposit paid! Rental is now active.");
      setSelectedProperty(null);
      fetchMyRentals();
      fetchAllProperties();
    } catch (err) {
      if (err.code === 4001) alert("Transaction rejected in MetaMask.");
      else if (err?.code === "INSUFFICIENT_FUNDS")
        alert("Insufficient funds on Hardhat Local.");
      else if (err?.code === "CALL_EXCEPTION")
        alert(
          "Contract call failed. Ensure MetaMask is on Hardhat Local and try again.",
        );
      else alert("An unexpected blockchain error occurred. Please try again.");
    } finally {
      setActionLoading((prev) => ({ ...prev, [`tenant_${rentalId}`]: false }));
    }
  };
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      fetchAllProperties();
      return;
    }
    try {
      setIsSearching(true);
      const d = await authFetch(
        `/properties/search?q=${encodeURIComponent(searchQuery)}`,
      );
      setProperties(d.properties || []);
    } catch {
      setProperties([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleRaiseDispute = async ({
    rentalId,
    description,
    evidence_url,
  }) => {
    try {
      await authFetch("/disputes/raise", {
        method: "POST",
        body: JSON.stringify({ rentalId, description, evidence_url }),
      });
      alert("✅ Dispute raised! AI is processing your case.");
      setRaiseDisputeFor(null);
    } catch (err) {
      alert(err.message || "Failed to raise dispute");
    }
  };

  const getPropertyImages = (rental) => {
    if (!rental?.property_id) return [];
    const match = properties.find((p) => p.id === rental.property_id);
    return match?.images || [];
  };

  const isPropertyRequested = (propertyId) =>
    requestedPropertyIds.has(propertyId);
  const isPropertyRejected = (propertyId) =>
    rejectedPropertyIds.has(propertyId);
  const isPropertyActive = (propertyId) => activePropertyIds.has(propertyId);

  const fetchNotifications = async () => {
    try {
      const d = await authFetch("/notifications");
      const parsed = (d.notifications || []).map((n) => ({
        ...n,
        metadata: typeof n.metadata === "string" ? JSON.parse(n.metadata) : n.metadata,
      }));
      setNotifications(parsed);
    } catch (err) {
      console.error("Error fetching notifications:", err);
      setNotifications([]);
    }
  };

  const handleOpenNotifications = async () => {
    await fetchNotifications();
    setShowNotifications(true);
  };

  const enrichNotificationMessage = (note) => {
  if (!note.metadata?.rental_id) return note.message;
  const allRentals = [
    ...requestedProperties,
    ...approvedProperties,
    ...rejectedProperties,
    ...activeProperties,
    ...leaseExpiredProperties,
    ...reviewCompletedProperties,
  ];
  const rental = allRentals.find((r) => r.id === note.metadata.rental_id);
  if (!rental) return note.message;
  return `${note.message} — ${rental.property_title}`;
};

  const handleNotificationClick = async (note) => {
    if (!note.is_read) {
      try {
        await authFetch(`/notifications/${note.id}/read`, { method: "PATCH" });
        setNotifications((prev) =>
          prev.map((n) => (n.id === note.id ? { ...n, is_read: true } : n))
        );
      } catch (err) {
        console.error("Failed to mark notification as read:", err);
      }
    }

    if (note.metadata && note.metadata.rental_id) {
      const rentalId = note.metadata.rental_id;
      const allRentals = [
        ...requestedProperties,
        ...approvedProperties,
        ...rejectedProperties,
        ...activeProperties,
        ...leaseExpiredProperties,
        ...reviewCompletedProperties,
      ];
      const rental = allRentals.find((r) => r.id === rentalId);
      if (rental) {
        setSelectedProperty(rental);
        setShowNotifications(false);
      }
    }
  };

  const openReviewModal = (rental) => {
    setReviewRental(rental);
    setReviewRating(5);
    setReviewModal(true);
  };

  const closeReviewModal = () => {
    setReviewRental(null);
    setReviewRating(5);
    setReviewModal(false);
  };

  const submitReview = async () => {
    if (!reviewRental) return;
    if (
      typeof reviewRating !== "number" ||
      reviewRating < 0 ||
      reviewRating > 5
    ) {
      alert("Please select a valid rating between 0 and 5.");
      return;
    }
    setReviewSubmitting(true);
    try {
      await authFetch(`/rentals/${reviewRental.id}/review`, {
        method: "POST",
        body: JSON.stringify({ rating: reviewRating }),
      });
      alert("Rating submitted successfully.");
      closeReviewModal();
      fetchMyRentals();
    } catch (err) {
      alert(err.message);
    } finally {
      setReviewSubmitting(false);
    }
  };

  return (
    <div className="tenant-dashboard">
      <nav className="navbar">
        <div className="logo">🏠 Realtor</div>
        <form className="search-bar" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="Search by location, type, or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button type="submit" disabled={isSearching}>
            {isSearching ? "🔍" : "Search"}
          </button>
          {searchQuery && (
            <button
              type="button"
              className="clear-btn"
              onClick={() => {
                setSearchQuery("");
                fetchAllProperties();
              }}
            >
              ✕
            </button>
          )}
        </form>
        <div className="nav-buttons">
          <button
            className="notification-btn"
            onClick={handleOpenNotifications}
          >
            🔔
            {notifications.filter((n) => !n.is_read).length > 0 && (
              <span className="notification-badge">
                {notifications.filter((n) => !n.is_read).length}
              </span>
            )}
          </button>
          {walletAddress && (
            <div className="wallet-indicator">
              <span className="wallet-dot"></span>
              <span className="wallet-short">
                {shortenAddress(walletAddress)}
              </span>
            </div>
          )}
          <button
            className="community-btn"
            onClick={() => navigate("/community")}
          >
            🏛️ Community
          </button>
          <button
            className="profile-btn"
            onClick={() => setShowProfileModal(true)}
          >
            View Profile
          </button>
          <button className="logout-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </nav>

      <div className="dashboard-wrapper">
        <div className="left-column">
          <div className="column-section">
            <h3>Requested Properties</h3>
            {requestedProperties.length === 0 ? (
              <p className="no-properties">No requested properties</p>
            ) : (
              <div className="column-properties">
                {requestedProperties.map((r) => (
                  <div
                    key={r.id}
                    className="column-property-card"
                    onClick={() => setSelectedProperty(r)}
                  >
                    <h4>{r.property_title}</h4>
                    <p>📍 {r.property_location}</p>
                    <p className="price">
                      {Number(r.rent_amount).toLocaleString()} ETH/minute
                    </p>
                    <span className="status-badge pending">Pending</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="column-section">
            <h3>Rejected Properties</h3>
            {rejectedProperties.length === 0 ? (
              <p className="no-properties">No rejected properties</p>
            ) : (
              <div className="column-properties">
                {rejectedProperties.map((r) => (
                  <div
                    key={r.id}
                    className="column-property-card"
                    onClick={() => setSelectedProperty(r)}
                  >
                    <h4>{r.property_title}</h4>
                    <p>📍 {r.property_location}</p>
                    <p className="price">
                      {Number(r.rent_amount).toLocaleString()} ETH/minute
                    </p>
                    <span className="status-badge rejected">Rejected</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="column-section">
            <h3>Ready to Sign</h3>
            {approvedProperties.length === 0 ? (
              <p className="no-properties">No agreements to sign</p>
            ) : (
              <div className="column-items">
                {approvedProperties.map((r) => (
                  <div
                    key={r.id}
                    className="column-item-card"
                    onClick={() => setSelectedProperty(r)}
                  >
                    <h4>{r.property_title}</h4>
                    <p>📍 {r.property_location}</p>
                    <p className="price">
                      {Number(r.rent_amount).toLocaleString()} ETH/minute
                    </p>
                    <span className="status-badge approved">Sign Required</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="column-section">
            <h3>Active Rentals</h3>
            {activeProperties.length === 0 ? (
              <p className="no-properties">No active rentals</p>
            ) : (
              <div className="column-items">
                {activeProperties.map((r) => (
                  <div
                    key={r.id}
                    className="column-item-card active-card"
                    onClick={() => setSelectedProperty(r)}
                  >
                    <h4>{r.property_title}</h4>
                    <p>📍 {r.property_location}</p>
                    <p className="price">
                      {Number(r.rent_amount).toLocaleString()} ETH/minute
                    </p>
                    <div className="card-bottom-row">
                      {r.status === "PENDING_DEPOSIT" ? (
                        <span className="status-badge pending">
                          ⏳ Deposit Pending
                        </span>
                      ) : (
                        <span className="status-badge active">Active</span>
                      )}
                      {r.status === "ACTIVE" && (
                        <button
                          className="raise-issue-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRaiseDisputeFor(r);
                          }}
                        >
                          ⚖️ Raise Issue
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="column-section">
            <h3>Lease Expired</h3>
            {leaseExpiredProperties.length === 0 ? (
              <p className="no-properties">No expired leases</p>
            ) : (
              <div className="column-items">
                {leaseExpiredProperties.map((r) => (
                  <div
                    key={r.id}
                    className="column-item-card"
                    onClick={() => setSelectedProperty(r)}
                  >
                    <h4>{r.property_title}</h4>
                    <p>📍 {r.property_location}</p>
                    <p className="price">
                      {Number(r.rent_amount).toLocaleString()} ETH/minute
                    </p>
                    <div className="card-bottom-row">
                      {(user?.role === "TENANT" && !r.tenant_reviewed) ||
                      (user?.role === "LANDLORD" && !r.landlord_reviewed) ? (
                        <button
                          className="review-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            openReviewModal(r);
                          }}
                        >
                          ⭐ Submit Rating
                        </button>
                      ) : (
                        <span className="status-badge approved">Reviewed</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="column-section">
            <h3>Completed Rentals</h3>
            {reviewCompletedProperties.length === 0 ? (
              <p className="no-properties">No reviewed rentals</p>
            ) : (
              <div className="column-items">
                {reviewCompletedProperties.map((r) => (
                  <div
                    key={r.id}
                    className="column-item-card"
                    onClick={() => setSelectedProperty(r)}
                  >
                    <h4>{r.property_title}</h4>
                    <p>📍 {r.property_location}</p>
                    <p className="price">
                      {Number(r.rent_amount).toLocaleString()} ETH/minute
                    </p>
                    <span className="status-badge approved">
                      Review Completed
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="dashboard-content">
          <div className="content-header">
            <h2>Available Properties</h2>
            <p className="property-count">
              {properties.length}{" "}
              {properties.length === 1 ? "property" : "properties"} found
            </p>
          </div>
          {loading && <p className="loading-text">Loading...</p>}
          {!loading && properties.length === 0 && (
            <p className="empty-text">
              {searchQuery
                ? "No properties match your search."
                : "No properties available."}
            </p>
          )}
          <div className="properties-grid">
            {properties.map((p) => (
              <div
                key={p.id}
                className="property-card"
                onClick={() => setSelectedProperty(p)}
              >
                {p.images && p.images.length > 0 ? (
                  <div className="property-card-image">
                    <img src={p.images[0].image_url} alt={p.title} />
                  </div>
                ) : (
                  <div className="property-card-image property-card-image--placeholder">
                    <span>🏠</span>
                  </div>
                )}
                <div className="property-card-body">
                  <div className="property-summary">
                    <div className="property-header">
                      <h4>{p.property_type}</h4>
                      <p className="location">
                        📍 {p.location}
                        {p.city ? `, ${p.city}` : ""}
                      </p>
                      {p.rating > 0 && (
                        <p className="property-rating">⭐ {p.rating > 0 ? Number(p.rating).toFixed(1) : "-"}</p>
                      )}
                    </div>
                    <span className="rent">
                      {Number(p.rent_amount).toLocaleString()} ETH/minute
                    </span>
                  </div>
                  {isPropertyActive(p.id) && (
                    <div className="requested-overlay">
                      <span className="requested-label">🏠 Rented</span>
                    </div>
                  )}
                  {!isPropertyActive(p.id) && isPropertyRequested(p.id) && (
                    <div className="requested-overlay">
                      <span className="requested-label">✓ Requested</span>
                    </div>
                  )}
                  {!isPropertyActive(p.id) &&
                    !isPropertyRequested(p.id) &&
                    isPropertyRejected(p.id) && (
                      <div className="rejected-overlay">
                        <span className="rejected-label">❌ Rejected</span>
                      </div>
                    )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PROFILE MODAL */}
      {showProfileModal && user && (
        <div
          className="modal-overlay"
          onClick={() => {
            setShowProfileModal(false);
            setIsEditingProfile(false);
          }}
        >
          <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="close-btn"
              onClick={() => {
                setShowProfileModal(false);
                setIsEditingProfile(false);
              }}
            >
              ✕
            </button>
            <div className="profile-header">
              <div className="profile-icon">👤</div>
              <h3>Profile Details</h3>
            </div>
            {!isEditingProfile ? (
              <div className="profile-content">
                <div className="profile-field">
                  <label>Username</label>
                  <p>{user.username}</p>
                </div>
                <div className="profile-field">
                  <label>Phone</label>
                  <p>{user.phone}</p>
                </div>
                <div className="profile-field">
                  <label>Role</label>
                  <p className="role-badge">{user.role}</p>
                </div>
                <div className="profile-field">
                  <label>Trust Score</label>
                  <p className="role-badge">⭐ {user.trust_score ?? 0}</p>
                </div>
                <div className="profile-field">
                  <label>Wallet</label>
                  {walletAddress ? (
                    <div className="wallet-address-display">
                      <span className="wallet-dot-green"></span>
                      <p className="wallet-full">{walletAddress}</p>
                    </div>
                  ) : (
                    <p className="wallet-not-connected">Not connected</p>
                  )}
                </div>
                <button
                  className="edit-profile-btn"
                  onClick={() => setIsEditingProfile(true)}
                >
                  ✏️ Edit Profile
                </button>
              </div>
            ) : (
              <form
                className="profile-edit-form"
                onSubmit={handleUpdateProfile}
              >
                <div className="form-group">
                  <label>Username</label>
                  <input
                    type="text"
                    name="username"
                    value={profileFormData.username}
                    onChange={handleProfileChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    type="tel"
                    name="phone"
                    value={profileFormData.phone}
                    onChange={handleProfileChange}
                    required
                  />
                </div>
                <div className="profile-form-buttons">
                  <button type="submit" className="save-btn">
                    Save
                  </button>
                  <button
                    type="button"
                    className="cancel-btn"
                    onClick={() => {
                      setIsEditingProfile(false);
                      setProfileFormData({
                        username: user.username,
                        phone: user.phone,
                      });
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* AVAILABLE PROPERTY MODAL */}
      {selectedProperty && !selectedProperty.status && (
        <div
          className="modal-overlay"


          onClick={() => setSelectedProperty(null)}
        >
          <div className="property-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="close-btn"
              onClick={() => setSelectedProperty(null)}
            >
              ✕
            </button>
            <div className="modal-header">
              <h3>{selectedProperty.property_type}</h3>
              <p className="location">
                📍 {selectedProperty.location}
                {selectedProperty.city ? `, ${selectedProperty.city}` : ""}
              </p>
              <span className="rent-large">
                {Number(selectedProperty.rent_amount).toLocaleString()} ETH/minute
              </span>
            </div>
            <div className="modal-content">
              <h4 className="title">{selectedProperty.title}</h4>
              {selectedProperty.description && (
                <p className="description">{selectedProperty.description}</p>
              )}
              <div className="specs">
                <div className="spec-item">
                  <span className="spec-icon">🛏️</span>
                  <span>{selectedProperty.bedrooms} Bed</span>
                </div>
                <div className="spec-item">
                  <span className="spec-icon">🚿</span>
                  <span>{selectedProperty.bathrooms} Bath</span>
                </div>
                <div className="spec-item">
                  <span className="spec-icon">📐</span>
                  <span>
                    {Number(selectedProperty.area_sqft).toLocaleString()} sqft
                  </span>
                </div>
                <div className="spec-item">
                  <span className="spec-icon">👥</span>
                  <span>Max {selectedProperty.max_tenants}</span>
                </div>
                <div className="spec-item">
                  <span className="spec-icon">🛋️</span>
                  <span>
                    {formatFurnishing(selectedProperty.furnishing_status)}
                  </span>
                </div>
              </div>
              <div className="financial-info">
                <p>
                  <b>Security Deposit:</b> {" "}
                  {Number(selectedProperty.security_deposit).toLocaleString()} ETH
                </p>
                <p>
                  <b>Maintenance:</b> {" "} 
                  {Number(selectedProperty.maintenance_charge).toLocaleString()}
                    ETH/minute
                </p>
              </div>
              <div className="landlord-info">
                <h6>Landlord Contact</h6>
                <p>
                  <b>Name:</b> {selectedProperty.landlord_name}
                </p>
                <p>
                  <b>Phone:</b> {selectedProperty.landlord_phone}
                </p>
              </div>
              {selectedProperty.terms_and_conditions && (
                <div className="terms-section">
                  <p>
                    <b>Terms:</b>
                  </p>
                  <p className="terms-text">
                    {selectedProperty.terms_and_conditions}
                  </p>
                </div>
              )}
              {selectedProperty.images &&
                selectedProperty.images.length > 0 && (
                  <div className="modal-image-gallery">
                    <div className="modal-gallery-label">
                      📸 Property Photos ({selectedProperty.images.length})
                    </div>
                    <div className="modal-gallery-grid">
                      {selectedProperty.images.map((img, i) => (
                        <img
                          key={i}
                          src={img.image_url}
                          alt={`property-${i}`}
                          className={`modal-gallery-img ${i === 0 ? "modal-gallery-img--cover" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightbox({
                              images: selectedProperty.images,
                              startIndex: i,
                            });
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              {isPropertyRequested(selectedProperty.id) ? (
                <button className="requested-btn" disabled>
                  ✓ Already Requested
                </button>
              ) : (
                <div className="duration-request-group">
                  <div className="duration-input-row">
                    <label htmlFor="rentedDuration">
                      Lease Duration (minutes)
                    </label>
                    <input
                      id="rentedDuration"
                      type="number"
                      min="1"
                      step="1"
                      value={rentedDuration}
                      onChange={(e) => setRentedDuration(e.target.value)}
                      className="duration-input"
                    />
                  </div>
                  <button
                    className="contact-btn"
                    onClick={() => handleRequestProperty(selectedProperty.id)}
                  >
                    Request Property
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* RENTAL DETAILS MODAL */}
      {selectedProperty && selectedProperty.status && (
        <div
          className="modal-overlay"
          onClick={() => setSelectedProperty(null)}
        >
          <div className="property-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="close-btn"
              onClick={() => setSelectedProperty(null)}
            >
              ✕
            </button>
            <div className="modal-header">
              <h3>{selectedProperty.property_title}</h3>
              <p className="location">
                📍 {selectedProperty.property_location}
                {selectedProperty.property_city
                  ? `, ${selectedProperty.property_city}`
                  : ""}
              </p>
              <span className="rent-large">
                {Number(selectedProperty.rent_amount).toLocaleString()} ETH/minute
              </span>
              <span
                className={`status-badge-large ${selectedProperty.status.toLowerCase()}`}
              >
                {selectedProperty.status}
              </span>
            </div>
            <div className="modal-content">
              <div className="rental-details-section">
                <h6>Rental Details</h6>
                <p>
                  <b>Requested On:</b> {formatDate(selectedProperty.created_at)}
                </p>
                {selectedProperty.start_date && (
                  <p>
                    <b>Start Date:</b> {formatDate(selectedProperty.start_date)}
                  </p>
                )}
                <p>
                  <b>Lease:</b> {selectedProperty.lease_duration} minute
                  {selectedProperty.lease_duration !== 1 ? "s" : ""}
                </p>
                <p>
                  <b>Type:</b> {selectedProperty.property_type}
                </p>
                <p>
                  <b>Furnishing:</b>{" "}
                  {formatFurnishing(selectedProperty.furnishing_status)}
                </p>
              </div>
              <div className="financial-info">
                <p>
                  <b>Rent:</b> {" "}
                  {Number(selectedProperty.rent_amount).toLocaleString()} ETH/minute
                </p>
                <p>
                  <b>Deposit:</b> {" "}
                  {Number(selectedProperty.security_deposit).toLocaleString()} ETH
                </p>
                <p>
                  <b>Maintenance:</b> {" "}
                  {Number(selectedProperty.maintenance_charge).toLocaleString()}
                  ETH/minute
                </p>
              </div>
              <div className="landlord-info">
                <h6>Landlord Contact</h6>
                <p>
                  <b>Name:</b> {selectedProperty.landlord_name}
                </p>
                <p>
                  <b>Phone:</b> {selectedProperty.landlord_phone}
                </p>
              </div>
              {selectedProperty.terms_and_conditions && (
                <div className="terms-section">
                  <p>
                    <b>Terms:</b>
                  </p>
                  <p className="terms-text">
                    {selectedProperty.terms_and_conditions}
                  </p>
                </div>
              )}
              {(() => {
                const imgs = getPropertyImages(selectedProperty);
                return imgs.length > 0 ? (
                  <div className="modal-image-gallery">
                    <div className="modal-gallery-label">
                      📸 Property Photos ({imgs.length})
                    </div>
                    <div className="modal-gallery-grid">
                      {imgs.map((img, i) => (
                        <img
                          key={i}
                          src={img.image_url}
                          alt={`property-${i}`}
                          className={`modal-gallery-img ${i === 0 ? "modal-gallery-img--cover" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightbox({ images: imgs, startIndex: i });
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}

              {selectedProperty.status === "PENDING" && (
                <div className="status-info pending">
                  <p>
                    ⏳ Waiting for landlord to review and approve your request.
                  </p>
                  <button
                    className="cancel-request-btn"
                    onClick={() => handleCancelRequest(selectedProperty.id)}
                  >
                    ✕ Cancel Request
                  </button>
                </div>
              )}

              {selectedProperty.status === "REJECTED" && (
                <div className="status-info rejected">
                  <p>❌ Your request was rejected by the landlord.</p>
                  <button
                    className="request-again-btn"
                    onClick={() =>
                      handleRequestAgain(selectedProperty.property_id)
                    }
                    disabled={
                      isPropertyRequested(selectedProperty.property_id) ||
                      isPropertyActive(selectedProperty.property_id)
                    }
                  >
                    {isPropertyRequested(selectedProperty.property_id) ||
                    isPropertyActive(selectedProperty.property_id)
                      ? "Already Requested"
                      : "Request Again"}
                  </button>
                </div>
              )}

              {(selectedProperty.status === "APPROVED" ||
                selectedProperty.status === "PENDING_DEPOSIT") && (
                <div
                  className={`status-info ${selectedProperty.status === "APPROVED" ? "approved" : "pending"}`}
                >
                  <p>
                    {selectedProperty.status === "APPROVED"
                      ? "✅ Landlord has signed. Review the agreement, then sign and pay deposit to activate."
                      : "⏳ Agreement signed & deployed. Please complete the deposit payment."}
                  </p>
                  <div className="agreement-actions">
                    <button
                      className="agreement-action-btn view-btn"
                      onClick={() => handleViewAgreement(selectedProperty.id)}
                    >
                      👁 View Agreement
                    </button>
                    <button
                      className="agreement-action-btn sign-btn"
                      onClick={() =>
                        handleDepositWorkflow(
                          selectedProperty.id,
                          selectedProperty,
                        )
                      }
                      disabled={actionLoading[`tenant_${selectedProperty.id}`]}
                    >
                      {actionLoading[`tenant_${selectedProperty.id}`]
                        ? "⏳ Processing..."
                        : selectedProperty.status === "APPROVED"
                          ? "✍️ Sign & Pay Deposit"
                          : "💳 Pay Deposit"}
                    </button>
                  </div>
                </div>
              )}

              {selectedProperty.status === "ACTIVE" && (
                <div className="status-info active">
                  <p>✅ Your rental is active. Both parties have signed.</p>
                  <div className="agreement-actions">
                    <button
                      className="agreement-action-btn view-btn active-view"
                      onClick={() => handleViewAgreement(selectedProperty.id)}
                    >
                      👁 View Agreement
                    </button>
                    {/* ── Opens PayRentModal instead of direct inline call ── */}
                    <button
                      className="agreement-action-btn sign-btn"
                      onClick={() => {
                        setSelectedProperty(null);
                        setPayRentFor(selectedProperty);
                      }}
                    >
                      💰 Pay Rent
                    </button>
                  </div>
                  <button
                    className="raise-issue-modal-btn"
                    onClick={() => {
                      setSelectedProperty(null);
                      setRaiseDisputeFor(selectedProperty);
                    }}
                  >
                    ⚖️ Raise Issue
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AGREEMENT LOADING OVERLAY */}
      {agreementLoading && (
        <div className="agreement-loading-overlay">
          <div className="agreement-loading-box">
            <div className="agreement-spinner"></div>
            <p>Fetching agreement from blockchain...</p>
            <span>This may take a few seconds</span>
          </div>
        </div>
      )}

      {/* LIGHTBOX */}
      {lightbox && (
        <Lightbox
          images={lightbox.images}
          startIndex={lightbox.startIndex}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* RAISE DISPUTE MODAL */}
      {raiseDisputeFor && (
        <RaiseDisputeModal
          rental={raiseDisputeFor}
          onClose={() => setRaiseDisputeFor(null)}
          onSubmit={handleRaiseDispute}
        />
      )}

      {/* NOTIFICATIONS MODAL */}
      {showNotifications && (
        <div
          className="modal-overlay"
          onClick={() => setShowNotifications(false)}
        >
          <div
            className="notifications-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close-btn"
              onClick={() => setShowNotifications(false)}
            >
              ✕
            </button>
            <div className="notifications-header">
              <h3>Notifications</h3>
              <p>{notifications.filter((n) => !n.is_read).length} unread</p>
            </div>
            {notifications.length === 0 ? (
              <p className="no-notifications">No notifications</p>
            ) : (
              <div className="notifications-list">
                {notifications.map((note) => (
                  <div
                    key={note.id}
                    className={`notification-item ${note.is_read ? "read" : "unread"} ${note.metadata && note.metadata.rental_id ? "clickable" : ""}`}
                    onClick={() => handleNotificationClick(note)}
                  >
                    <p className="notification-message">{enrichNotificationMessage(note)}</p>
                    <span className="notification-meta">
                      {new Date(note.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* REVIEW MODAL */}
      {reviewModal && reviewRental && (
        <div className="modal-overlay" onClick={closeReviewModal}>
          <div className="review-modal" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={closeReviewModal}>
              ✕
            </button>
            <h3>Submit Rating</h3>
            <p>
              {reviewRental.property_title || "Rental"} -{" "}
              {reviewRental.property_location}
            </p>
            <div className="form-group">
              <label>Rating (0-5)</label>
              <input
                type="number"
                min="0"
                max="5"
                value={reviewRating}
                onChange={(e) => setReviewRating(Number(e.target.value))}
              />
            </div>
            <button
              className="review-btn"
              onClick={submitReview}
              disabled={reviewSubmitting}
            >
              {reviewSubmitting ? "Submitting..." : "Submit Rating"}
            </button>
          </div>
        </div>
      )}

      {/* PAY RENT MODAL */}
      {payRentFor && (
        <PayRentModal
          rental={payRentFor}
          walletAddress={walletAddress}
          onClose={() => setPayRentFor(null)}
          onSuccess={() => {
            setPayRentFor(null);
            fetchMyRentals();
          }}
        />
      )}
    </div>
  );
};

export default TenantDashboard;
