import { useEffect, useState } from "react";
import { authFetch } from "../utils/authFetch";
import { useNavigate } from "react-router-dom";
import "../styles/adminDashboard.css";

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [pendingProperties, setPendingProperties] = useState([]);
  const [approvedProperties, setApprovedProperties] = useState([]);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [activeTab, setActiveTab] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [showProfileModal, setShowProfileModal] = useState(false);

  useEffect(() => {
    fetchUserProfile();
    fetchProperties();
  }, []);

  const fetchUserProfile = async () => {
    try {
      const data = await authFetch("/auth/me");
      setUser(data.user);
      // Redirect if not admin
      if (data.user.role !== "admin" && data.user.role !== "ADMIN") {
        navigate("/");
      }
    } catch (err) {
      console.error("Failed to fetch profile:", err);
      navigate("/");
    }
  };

  const fetchProperties = async () => {
    try {
      const data = await authFetch("/properties/admin/all");
      const all = data.properties || [];
      setPendingProperties(all.filter((p) => !p.is_approved));
      setApprovedProperties(all.filter((p) => p.is_approved));
    } catch (err) {
      console.error("Failed to fetch properties:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (propertyId) => {
    try {
      await authFetch(`/properties/approve/${propertyId}`, { method: "PATCH" });
      alert("Property approved successfully!");

      // Optimistically update state before re-fetch
      const approvedProp = pendingProperties.find((p) => p.id === propertyId);
      if (approvedProp) {
        const updatedProp = { ...approvedProp, is_approved: true };
        setPendingProperties((prev) => prev.filter((p) => p.id !== propertyId));
        setApprovedProperties((prev) => [...prev, updatedProp]);
        // Update selected property so the modal reflects the new status immediately
        setSelectedProperty(updatedProp);
      } else {
        setSelectedProperty(null);
      }

      fetchProperties();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleReject = async (propertyId) => {
    if (!window.confirm("Are you sure you want to reject and delete this property?")) return;
    try {
      await authFetch(`/properties/reject/${propertyId}`, { method: "PATCH" });
      alert("Property rejected.");
      setSelectedProperty(null);
      fetchProperties();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("role");
    sessionStorage.removeItem("user");
    navigate("/");
  };

  const displayList = activeTab === "pending" ? pendingProperties : approvedProperties;

  return (
    <div className="admin-dashboard">
      {/* NAVBAR */}
      <nav className="navbar">
        <div className="logo">🏠 Realtor — Admin</div>
        <div className="nav-buttons">
          <button className="profile-btn" onClick={() => setShowProfileModal(true)}>
            View Profile
          </button>
          <button className="logout-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </nav>

      {/* MAIN LAYOUT */}
      <div className="dashboard-wrapper">
        {/* LEFT SIDEBAR */}
        <div className="left-column">
          <div className="column-section">
            <h2>Overview</h2>
            <div className="stat-card">
              <span className="stat-label">Pending Approval</span>
              <span className="stat-value pending-color">{pendingProperties.length}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Approved Properties</span>
              <span className="stat-value approved-color">{approvedProperties.length}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Total Properties</span>
              <span className="stat-value">{pendingProperties.length + approvedProperties.length}</span>
            </div>
          </div>

          <div className="column-section">
            <h3>Quick Actions</h3>
            <button
              className={`tab-btn ${activeTab === "pending" ? "active" : ""}`}
              onClick={() => setActiveTab("pending")}
            >
              ⏳ Pending ({pendingProperties.length})
            </button>
            <button
              className={`tab-btn ${activeTab === "approved" ? "active" : ""}`}
              onClick={() => setActiveTab("approved")}
            >
              ✅ Approved ({approvedProperties.length})
            </button>
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div className="dashboard-content">
          <div className="content-header">
            <h2>{activeTab === "pending" ? "Pending Properties" : "Approved Properties"}</h2>
            <p className="property-count">
              {displayList.length} {displayList.length === 1 ? "property" : "properties"}
            </p>
          </div>

          {loading && <p className="loading-text">Loading properties...</p>}

          {!loading && displayList.length === 0 && (
            <p className="empty-text">
              {activeTab === "pending"
                ? "No properties pending approval."
                : "No approved properties yet."}
            </p>
          )}

          <div className="properties-grid">
            {displayList.map((p) => (
              <div
                key={p.id}
                className="property-card"
                onClick={() => setSelectedProperty(p)}
              >
                <div className="property-summary">
                  <div className="property-header">
                    <h4>{p.property_type || "Property"}</h4>
                    <p className="location">📍 {p.location}</p>
                    <p className="landlord-name">👤 {p.landlord_name}</p>
                  </div>
                  <span className="rent">
                    {Number(p.rent_amount).toLocaleString()} ETH/minute
                  </span>
                </div>
                <div className="card-footer">
                  <span className={`status-badge ${p.is_approved ? "approved" : "pending"}`}>
                    {p.is_approved ? "✅ Approved" : "⏳ Pending"}
                  </span>
                  <span className="card-date">
                    {new Date(p.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PROFILE MODAL */}
      {showProfileModal && user && (
        <div className="modal-overlay" onClick={() => setShowProfileModal(false)}>
          <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setShowProfileModal(false)}>✕</button>
            <div className="profile-header">
              <div className="profile-icon">👤</div>
              <h3>Admin Profile</h3>
            </div>
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
            </div>
          </div>
        </div>
      )}

      {/* PROPERTY DETAILS MODAL */}
      {selectedProperty && (
        <div className="modal-overlay" onClick={() => setSelectedProperty(null)}>
          <div className="property-modal" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setSelectedProperty(null)}>✕</button>

            <div className="modal-header">
              <h3>{selectedProperty.property_type || "Property"}</h3>
              <p className="location">📍 {selectedProperty.location}</p>
              <span className="rent-large">
                {Number(selectedProperty.rent_amount).toLocaleString()} ETH/minute
              </span>
            </div>

            <div className="modal-content">
              <h4 className="title">{selectedProperty.title}</h4>
              <p className="description">{selectedProperty.description}</p>

              <div className="specs">
                <div className="spec-item">
                  <span className="spec-icon">🛏️</span>
                  <span>{selectedProperty.bedrooms} Bedrooms</span>
                </div>
                <div className="spec-item">
                  <span className="spec-icon">🚿</span>
                  <span>{selectedProperty.bathrooms} Bathrooms</span>
                </div>
                <div className="spec-item">
                  <span className="spec-icon">📐</span>
                  <span>{Number(selectedProperty.area_sqft).toLocaleString()} sqft</span>
                </div>
              </div>

              <div className="financial-info">
                <p><b>Security Deposit:</b> {Number(selectedProperty.security_deposit).toLocaleString()} ETH</p>
                <p><b>Landlord:</b> {selectedProperty.landlord_name}</p>
                <p><b>Phone:</b> {selectedProperty.landlord_phone}</p>
                <p><b>Listed On:</b> {new Date(selectedProperty.created_at).toLocaleDateString()}</p>
                <p>
                  <b>Status:</b>{" "}
                  <span className={`status-badge ${selectedProperty.is_approved ? "approved" : "pending"}`}>
                    {selectedProperty.is_approved ? "✅ Approved" : "⏳ Pending Approval"}
                  </span>
                </p>
              </div>

              {!selectedProperty.is_approved && (
                <div className="action-buttons">
                  <button className="approve-btn" onClick={() => handleApprove(selectedProperty.id)}>
                    ✓ Approve Property
                  </button>
                  <button className="reject-btn" onClick={() => handleReject(selectedProperty.id)}>
                    ✕ Reject Property
                  </button>
                </div>
              )}

              {!!selectedProperty.is_approved && (
                <div className="status-info approved">
                  <p>✓ This property is approved and visible to tenants.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;