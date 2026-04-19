import { useEffect, useState, useCallback } from "react";
import { authFetch } from "../utils/authFetch";
import { useNavigate } from "react-router-dom";
import "../styles/communityDashboard.css";

const TRUST_THRESHOLD = 75;

const STATUS_COLORS = {
  RAISED: "status--raised",
  AI_SUGGESTED: "status--ai",
  VOTING_OPEN: "status--voting",
  RESOLVED: "status--resolved",
};

const STATUS_LABELS = {
  RAISED: "⏳ Raised",
  AI_SUGGESTED: "🤖 AI Suggested",
  VOTING_OPEN: "🗳️ Voting Open",
  RESOLVED: "✅ Resolved",
};

// ─── Dispute Card ────────────────────────────────────────────────────────────
const DisputeCard = ({ dispute, isParty, onVote, onAcceptAi, onRejectAi, hasVoted, myAccepted, responded, onClick }) => {
  const isUncertain = dispute.ai_decision === "UNCERTAIN";
  const canVote     = dispute.status === "VOTING_OPEN" && !isParty && !hasVoted;
  const canRespond  = dispute.status === "AI_SUGGESTED" && isParty;

  // ── Live countdown ticker ──
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (dispute.status !== "VOTING_OPEN") return;
    const id = setInterval(() => forceUpdate((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, [dispute.status]);

  // Calculate time left for voting
  const getTimeLeft = () => {
    if (dispute.status !== "VOTING_OPEN" || !dispute.start_time || !dispute.duration) return null;
    const now = new Date();
    const endTime = new Date(dispute.start_time).getTime() + dispute.duration;
    const timeLeft = endTime - now.getTime();
    if (timeLeft <= 0) return "Voting closed";
    const hours = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m left`;
  };

  return (
    <div
      className={`dispute-card ${dispute.status === "RESOLVED" ? "dispute-card--resolved" : ""} ${isParty ? "dispute-card--mine" : ""}`}
      onClick={onClick}
    >
      <div className="dispute-card__header">
        <div className="dispute-card__meta">
          <span className={`dispute-status ${STATUS_COLORS[dispute.status] || ""}`}>
            {STATUS_LABELS[dispute.status] || dispute.status}
          </span>
          <span className="dispute-raised-by">
            Raised by <strong>{dispute.raised_by}</strong>
            {isParty && <span className="dispute-party-tag">· Your Rental</span>}
          </span>
        </div>
        <span className="dispute-id">#{dispute.id}</span>
      </div>

      <p className="dispute-description">{dispute.description}</p>

      {dispute.status === "VOTING_OPEN" && getTimeLeft() && (
        <div className="dispute-time-left">
          ⏰ {getTimeLeft()}
        </div>
      )}

      {dispute.evidence_url && (
        <a href={dispute.evidence_url} target="_blank" rel="noreferrer" className="dispute-evidence-link">
          📎 View Evidence
        </a>
      )}

      {/* AI Decision Block */}
      {["AI_SUGGESTED", "VOTING_OPEN", "RESOLVED"].includes(dispute.status) && dispute.ai_decision && (
        <div className={`dispute-ai-block ${isUncertain ? "dispute-ai-block--uncertain" : ""}`}>
          <div className="dispute-ai-label">🤖 AI Decision</div>
          <div className="dispute-ai-decision">
            {isUncertain
              ? <span className="dispute-ai-uncertain">⚖️ Uncertain — sent to community vote</span>
              : <>Favors: <strong>{dispute.ai_decision}</strong></>
            }
          </div>
          {dispute.ai_reasoning && (
            <p className="dispute-ai-reasoning">{dispute.ai_reasoning}</p>
          )}
        </div>
      )}

      {/* Acceptance status (for parties, only when not uncertain) */}
      {isParty && dispute.status === "AI_SUGGESTED" && !isUncertain && (
        <div className="dispute-acceptance-row">
          <span className={`dispute-accept-indicator ${dispute.tenant_accepted ? "accepted" : "pending"}`}>
            👤 Tenant: {dispute.tenant_accepted ? "✅ Accepted" : "⏳ Pending"}
          </span>
          <span className={`dispute-accept-indicator ${dispute.landlord_accepted ? "accepted" : "pending"}`}>
            🏠 Landlord: {dispute.landlord_accepted ? "✅ Accepted" : "⏳ Pending"}
          </span>
        </div>
      )}

      {/* Final Decision */}
      {dispute.status === "RESOLVED" && dispute.final_decision && (
        <div className="dispute-final">
          🏆 Final Decision: <strong>{dispute.final_decision}</strong>
        </div>
      )}

      {/* ── Actions ── */}
      <div className="dispute-card__actions">

        {/* Accept/Reject controls */}
        {canRespond && (
          <div className="dispute-accept-block">
            <p className="dispute-accept-hint">AI has made a decision. Do you agree?</p>
            <button className="dispute-btn dispute-btn--accept" onClick={() => onAcceptAi(dispute.id)} disabled={responded}>
              ✅ Accept AI Decision
            </button>
            <button className="dispute-btn dispute-btn--reject" onClick={() => onRejectAi(dispute.id)} disabled={responded}>
              ❌ Reject — Send to Vote
            </button>
          </div>
        )}

        {/* Party response status */}
        {isParty && dispute.status === "AI_SUGGESTED" && responded && (
          <div className="dispute-voted-badge">
            {myAccepted ? "✓ You accepted — waiting for the other party" : "✗ You rejected — waiting for the other party"}
          </div>
        )}

        {/* Uncertain notice for parties */}
        {isParty && dispute.status === "AI_SUGGESTED" && isUncertain && (
          <div className="dispute-party-note">⚖️ AI was uncertain — both parties must respond. If either rejects, it goes to community voting.</div>
        )}

        {/* Community Vote */}
        {canVote && (
          <div className="dispute-vote-row">
            <span className="dispute-vote-label">Cast your vote:</span>
            <button className="dispute-btn dispute-btn--tenant" onClick={() => onVote(dispute.id, "TENANT")}>
              👤 Tenant
            </button>
            <button className="dispute-btn dispute-btn--landlord" onClick={() => onVote(dispute.id, "LANDLORD")}>
              🏠 Landlord
            </button>
          </div>
        )}

        {hasVoted && dispute.status === "VOTING_OPEN" && (
          <div className="dispute-voted-badge">✓ You have voted</div>
        )}

        {dispute.status === "VOTING_OPEN" && isParty && (
          <div className="dispute-party-note">Community members are voting on this dispute.</div>
        )}

        {dispute.status === "RAISED" && isParty && (
          <div className="dispute-party-note">⏳ AI is analysing your dispute...</div>
        )}
      </div>
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
const CommunityDashboard = () => {
  const navigate = useNavigate();
  const [user, setUser]                     = useState(null);
  const [disputes, setDisputes]             = useState([]);
  const [activeRentals, setActiveRentals]   = useState([]);
  const [loading, setLoading]               = useState(true);
  const [votedIds, setVotedIds]             = useState(new Set());
  const [acceptedIds, setAcceptedIds]       = useState(new Set());
  const [respondedIds, setRespondedIds]     = useState(new Set());
  const [filter, setFilter]                 = useState("ALL");
  const [selectedDispute, setSelectedDispute] = useState(null);
  const [eligible, setEligible]             = useState(false);
  const [activeTab, setActiveTab]           = useState("mine");

  const fetchUser = useCallback(async () => {
    try {
      const d = await authFetch("/auth/me");
      setUser(d.user);
      setEligible((d.user.trust_score ?? 0) >= TRUST_THRESHOLD);
    } catch { navigate("/"); }
  }, [navigate]);

  const fetchDisputes = useCallback(async () => {
    try {
      const d = await authFetch("/disputes/");
      // ── Deduplicate by id ──
      const seen = new Set();
      const unique = (d.disputes || []).filter((dispute) => {
        if (seen.has(dispute.id)) return false;
        seen.add(dispute.id);
        return true;
      });
      setDisputes(unique);
    } catch { setDisputes([]); }
  }, []);

  const fetchActiveRentals = useCallback(async () => {
    try {
      const d = await authFetch("/rentals/my");
      const all = d.rentals || [];
      const withDetails = await Promise.all(all.map(async (r) => {
        try { const det = await authFetch(`/rentals/${r.id}`); return det.rental?.property_title ? det.rental : r; } catch { return r; }
      }));
      setActiveRentals(withDetails.filter((r) => r.status === "ACTIVE"));
    } catch { setActiveRentals([]); }
  }, []);

  
  useEffect(() => {
  const init = async () => {
    setLoading(true);
    await fetchUser();
    await Promise.all([fetchDisputes(), fetchActiveRentals()]);
    setLoading(false);
  };
  init();
  const id = setInterval(fetchDisputes, 15000);
  return () => clearInterval(id);
}, [fetchUser, fetchDisputes, fetchActiveRentals]);

  // Derive isParty from rental_id matching user's active rentals
  const myRentalIds = new Set(activeRentals.map((r) => r.id));

  const myDisputes        = disputes.filter((d) => myRentalIds.has(d.rental_id));
  // Community only shows disputes open for voting — that's all outsiders can act on
  const communityDisputes = disputes.filter((d) => !myRentalIds.has(d.rental_id) && d.status === "VOTING_OPEN");

  const activeList   = activeTab === "mine" ? myDisputes : communityDisputes;
  // My disputes tab has status filters; community tab has no filters (always VOTING_OPEN)
  const filteredList = activeTab === "mine"
    ? activeList.filter((d) => filter === "ALL" || d.status === filter)
    : activeList;

  const countOf = (list) => ({
    ALL:          list.length,
    RAISED:       list.filter((d) => d.status === "RAISED").length,
    AI_SUGGESTED: list.filter((d) => d.status === "AI_SUGGESTED").length,
    VOTING_OPEN:  list.filter((d) => d.status === "VOTING_OPEN").length,
    RESOLVED:     list.filter((d) => d.status === "RESOLVED").length,
  });

  const counts = countOf(myDisputes); // counts only apply to My Disputes tab

  const handleVote = async (disputeId, vote) => {
    try {
      await authFetch(`/disputes/${disputeId}/vote`, { method: "POST", body: JSON.stringify({ disputeId, vote }) });
      setVotedIds((prev) => new Set([...prev, disputeId]));
      alert(`✅ Vote cast for ${vote}`);
      fetchDisputes();
    } catch (err) { alert(err.message || "Failed to cast vote"); }
  };

  const handleAcceptAi = async (disputeId) => {
  try {
    await authFetch(`/disputes/${disputeId}/ai-decision`, {
      method: "PATCH",
      body: JSON.stringify({ accepted: true }),
    });
    setAcceptedIds((prev) => new Set([...prev, disputeId]));
    setRespondedIds((prev) => new Set([...prev, disputeId]));
    alert("✅ AI decision accepted.");
    fetchDisputes();
  } catch (err) { alert(err.message || "Failed to accept AI decision"); }
};

const handleRejectAi = async (disputeId) => {
  try {
    await authFetch(`/disputes/${disputeId}/ai-decision`, {
      method: "PATCH",
      body: JSON.stringify({ accepted: false }),
    });
    setRespondedIds((prev) => new Set([...prev, disputeId]));
    alert("Decision rejected. Dispute will go to community voting.");
    fetchDisputes();
  } catch (err) { alert(err.message || "Failed to reject"); }
};

  const handleLogout = () => {
    sessionStorage.removeItem("token"); sessionStorage.removeItem("role"); sessionStorage.removeItem("user");
    navigate("/");
  };

  const switchTab = (tab) => {
    setActiveTab(tab);
    setFilter("ALL");
  };

  return (
    <div className="community-dashboard">
      <nav className="cd-navbar">
        <div className="cd-navbar__left">
          <div className="cd-logo">🏠 Realtor</div>
        </div>
        <div className="cd-navbar__right">
          {user && (
            <div className="cd-trust-badge">
              <span className="cd-trust-icon">⭐</span>
              <span>Trust Score: <strong>{user.trust_score ?? 0}</strong></span>
            </div>
          )}
          <button className="cd-logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </nav>

      <div className="cd-body">
        <div className="cd-inner">
        {loading ? (
          <div className="cd-loading">
            <div className="cd-spinner"></div>
            <p>Loading disputes...</p>
          </div>
        ) : (
          <>
            {/* Hero */}
            <div className="cd-hero">
              <h1>Community Disputes</h1>
              <p>AI-assisted, community-driven dispute resolution for rentals.</p>
            </div>

            {/* Tabs */}
            <div className="cd-tabs">
              <button
                className={`cd-tab ${activeTab === "mine" ? "cd-tab--active" : ""}`}
                onClick={() => switchTab("mine")}
              >
                📋 My Disputes
                {myDisputes.length > 0 && <span className="cd-tab-badge">{myDisputes.length}</span>}
              </button>
              <button
                className={`cd-tab ${activeTab === "community" ? "cd-tab--active" : ""}`}
                onClick={() => switchTab("community")}
              >
                🏛️ Community
                {communityDisputes.length > 0 && <span className="cd-tab-badge">{communityDisputes.length}</span>}
              </button>
            </div>

            {/* Ineligible banner — community tab only */}
            {activeTab === "community" && !eligible && (
              <div className="cd-ineligible-banner">
                <div className="cd-ineligible-banner__content">
                  <span>🔒</span>
                  <div>
                    <strong>Voting not available</strong>
                    <p>You need a trust score of {TRUST_THRESHOLD}+ to vote. Yours: <strong>{user?.trust_score ?? 0}</strong></p>
                  </div>
                </div>
                <div className="cd-ineligible-banner__bar-wrap">
                  <div className="cd-ineligible-banner__bar-fill" style={{ width: `${Math.min(100, ((user?.trust_score ?? 0) / TRUST_THRESHOLD) * 100)}%` }} />
                </div>
              </div>
            )}

            {/* Filter tabs — only for My Disputes */}
            {activeTab === "mine" && (
              <div className="cd-filters">
                {["ALL", "RAISED", "AI_SUGGESTED", "VOTING_OPEN", "RESOLVED"].map((f) => (
                  <button
                    key={f}
                    className={`cd-filter-tab ${filter === f ? "cd-filter-tab--active" : ""}`}
                    onClick={() => setFilter(f)}
                  >
                    {f.replace(/_/g, " ")}
                    <span className="cd-filter-count">{counts[f]}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Community tab info banner */}
            {activeTab === "community" && communityDisputes.length > 0 && (
              <div className="cd-voting-info">
                🗳️ These disputes are open for community voting. Voting closes after 24 hours.
              </div>
            )}

            {/* Disputes or empty state */}
            {filteredList.length === 0 ? (
              <div className="cd-empty">
                <span>{activeTab === "mine" ? "📋" : "📭"}</span>
                <p>
                  {activeTab === "mine"
                    ? "No disputes yet. Raise one from your active rentals."
                    : `No community disputes${filter !== "ALL" ? ` with status "${filter.replace(/_/g, " ")}"` : ""}.`
                  }
                </p>
              </div>
            ) : (
              <div className="cd-disputes-grid">
                {filteredList.map((d) => (
                  <DisputeCard
                    key={d.id}
                    dispute={d}
                    isParty={myRentalIds.has(d.rental_id)}
                    hasVoted={votedIds.has(d.id)}
                    myAccepted={acceptedIds.has(d.id)}
                    responded={respondedIds.has(d.id)}
                    onVote={handleVote}
                    onAcceptAi={handleAcceptAi}
                    onRejectAi={handleRejectAi}
                    onClick={() => setSelectedDispute(d)}
                  />
                ))}
              </div>
            )}
          </>
        )}
        </div>
      </div>

      {/* DISPUTE DETAIL MODAL */}
      {selectedDispute && (() => {
        const d = selectedDispute;
        const isParty = myRentalIds.has(d.rental_id);
        const isUncertain = d.ai_decision === "UNCERTAIN";
        const responded = respondedIds.has(d.id);
        const canAccept = d.status === "AI_SUGGESTED" && isParty;
        const canVote = d.status === "VOTING_OPEN" && !isParty && !votedIds.has(d.id) && eligible;
        return (
          <div className="cd-detail-overlay" onClick={() => setSelectedDispute(null)}>
            <div className="cd-detail-modal" onClick={(e) => e.stopPropagation()}>
              <div className="cd-detail-modal__header">
                <button className="cd-detail-close" onClick={() => setSelectedDispute(null)}>✕</button>
                <h3>Dispute #{d.id}</h3>
                <span className={`dispute-status ${STATUS_COLORS[d.status] || ""}`}>
                  {STATUS_LABELS[d.status] || d.status}
                </span>
              </div>
              <div className="cd-detail-modal__body">
                <div className="cd-detail-section">
                  <span className="cd-detail-section__label">Raised By</span>
                  <p className="cd-detail-section__text">
                    <strong>{d.raised_by}</strong>{isParty && " · Your Rental"}
                  </p>
                </div>
                <div className="cd-detail-section">
                  <span className="cd-detail-section__label">Description</span>
                  <p className="cd-detail-section__text">{d.description}</p>
                </div>
                {d.evidence_url && (
                  <div className="cd-detail-section">
                    <span className="cd-detail-section__label">Evidence</span>
                    <a href={d.evidence_url} target="_blank" rel="noreferrer" className="dispute-evidence-link">
                      📎 View Evidence
                    </a>
                  </div>
                )}
                {["AI_SUGGESTED", "VOTING_OPEN", "RESOLVED"].includes(d.status) && d.ai_decision && (
                  <div className={`cd-detail-ai-block ${isUncertain ? "cd-detail-ai-block--uncertain" : ""}`}>
                    <div className="cd-detail-ai-label">🤖 AI Decision</div>
                    <div className="cd-detail-ai-decision">
                      {isUncertain
                        ? <span style={{ color: "#c2410c" }}>⚖️ Uncertain — sent to community vote</span>
                        : <>Favors: <strong>{d.ai_decision}</strong></>
                      }
                    </div>
                    {d.ai_reasoning && (
                      <p className="cd-detail-ai-reasoning">{d.ai_reasoning}</p>
                    )}
                  </div>
                )}
                {isParty && d.status === "AI_SUGGESTED" && !isUncertain && (
                  <div className="dispute-acceptance-row">
                    <span className={`dispute-accept-indicator ${d.tenant_accepted ? "accepted" : "pending"}`}>
                      👤 Tenant: {d.tenant_accepted ? "✅ Accepted" : "⏳ Pending"}
                    </span>
                    <span className={`dispute-accept-indicator ${d.landlord_accepted ? "accepted" : "pending"}`}>
                      🏠 Landlord: {d.landlord_accepted ? "✅ Accepted" : "⏳ Pending"}
                    </span>
                  </div>
                )}
                {d.status === "RESOLVED" && d.final_decision && (
                  <div className="dispute-final">
                    🏆 Final Decision: <strong>{d.final_decision}</strong>
                  </div>
                )}
                <div className="cd-detail-actions">
                  {canAccept && (
                    <div className="dispute-accept-block">
                      <p className="dispute-accept-hint">AI has made a decision. Do you agree?</p>
                      <button
                        className="dispute-btn dispute-btn--accept"
                        onClick={() => { handleAcceptAi(d.id); setSelectedDispute(null); }}
                        disabled={responded}
                      >
                        ✅ Accept AI Decision
                      </button>
                      <button
                        className="dispute-btn dispute-btn--reject"
                        onClick={() => { handleRejectAi(d.id); setSelectedDispute(null); }}
                        disabled={responded}
                      >
                        ❌ Reject — Send to Vote
                      </button>
                    </div>
                  )}
                  {canVote && (
                    <div className="dispute-vote-row">
                      <span className="dispute-vote-label">Cast your vote:</span>
                      <button className="dispute-btn dispute-btn--tenant" onClick={() => { handleVote(d.id, "TENANT"); setSelectedDispute(null); }}>
                        👤 Tenant
                      </button>
                      <button className="dispute-btn dispute-btn--landlord" onClick={() => { handleVote(d.id, "LANDLORD"); setSelectedDispute(null); }}>
                        🏠 Landlord
                      </button>
                    </div>
                  )}
                  {votedIds.has(d.id) && d.status === "VOTING_OPEN" && (
                    <div className="dispute-voted-badge">✓ You have voted</div>
                  )}
                  {responded && d.status === "AI_SUGGESTED" && isParty && (
                    <div className="dispute-voted-badge">
                      {acceptedIds.has(d.id)
                        ? "✓ You accepted — waiting for the other party"
                        : "✗ You rejected — waiting for the other party"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}


    </div>
  );
};

export default CommunityDashboard;