import { useEffect, useState, useRef } from "react";
import { authFetch } from "../utils/authFetch";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import { RENTAL_CONTRACT_ADDRESS } from "../config/contractAddress";
import "../styles/landlordDashboard.css";

const FURNISHING_OPTIONS = ["UNFURNISHED", "SEMI_FURNISHED", "FULLY_FURNISHED"];

const emptyForm = {
  title: "",
  description: "",
  location: "",
  city: "",
  property_type_id: "",
  rent_amount: "",
  security_deposit: "",
  maintenance_charge: "",
  bedrooms: "",
  bathrooms: "",
  area_sqft: "",
  max_tenants: "",
  furnishing_status: "UNFURNISHED",
  terms_and_conditions: "",
};

// ─── Image Upload Field ──────────────────────────────────────────────────────
const ImageUploadField = ({ images, setImages }) => {
  const inputRef = useRef(null);
  const [previews, setPreviews] = useState([]);

  const handleFiles = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const combined = [...images, ...files].slice(0, 10);
    setImages(combined);
    setPreviews(combined.map((f) => URL.createObjectURL(f)));
  };

  const removeImage = (idx) => {
    const updated = images.filter((_, i) => i !== idx);
    setImages(updated);
    setPreviews(updated.map((f) => URL.createObjectURL(f)));
  };

  return (
    <div className="pf-section">
      <div className="pf-section-title">Property Images</div>
      <div className="pf-field">
        <label>
          Upload Images{" "}
          <span className="pf-hint">(first image shown on card · max 10)</span>
        </label>
        <div
          className="image-drop-zone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (!files.length) return;
            const combined = [...images, ...files].slice(0, 10);
            setImages(combined);
            setPreviews(combined.map((f) => URL.createObjectURL(f)));
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={handleFiles}
          />
          {previews.length === 0 ? (
            <div className="image-drop-placeholder">
              <span className="image-drop-icon">📷</span>
              <span>Click or drag &amp; drop images here</span>
              <span className="pf-hint">JPG, PNG, WEBP supported</span>
            </div>
          ) : (
            <div className="image-preview-grid">
              {previews.map((src, idx) => (
                <div
                  key={idx}
                  className={`image-preview-item ${idx === 0 ? "image-preview-first" : ""}`}
                >
                  <img src={src} alt={`preview-${idx}`} />
                  {idx === 0 && (
                    <span className="image-first-badge">Cover</span>
                  )}
                  <button
                    type="button"
                    className="image-remove-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(idx);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {previews.length < 10 && (
                <div
                  className="image-add-more"
                  onClick={(e) => {
                    e.stopPropagation();
                    inputRef.current?.click();
                  }}
                >
                  <span>＋</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const PropertyFormFields = ({
  formData,
  handleChange,
  propertyTypes,
  images,
  setImages,
}) => (
  <div className="property-form-fields">
    <div className="pf-section">
      <div className="pf-section-title">Basic Info</div>
      <div className="pf-field">
        <label>Title *</label>
        <input
          name="title"
          placeholder="e.g. Spacious 2BHK near Metro"
          value={formData.title}
          required
          onChange={handleChange}
        />
      </div>
      <div className="pf-field">
        <label>Description</label>
        <textarea
          name="description"
          placeholder="Describe the property..."
          value={formData.description}
          onChange={handleChange}
          rows={3}
        />
      </div>
    </div>
    <div className="pf-section">
      <div className="pf-section-title">Location</div>
      <div className="pf-row">
        <div className="pf-field">
          <label>Address *</label>
          <input
            name="location"
            placeholder="Street / Area"
            value={formData.location}
            required
            onChange={handleChange}
          />
        </div>
        <div className="pf-field">
          <label>City *</label>
          <input
            name="city"
            placeholder="City"
            value={formData.city}
            required
            onChange={handleChange}
          />
        </div>
      </div>
    </div>
    <div className="pf-section">
      <div className="pf-section-title">Property Details</div>
      <div className="pf-row">
        <div className="pf-field">
          <label>Property Type *</label>
          <select
            name="property_type_id"
            value={formData.property_type_id}
            required
            onChange={handleChange}
          >
            <option value="">Select type</option>
            {propertyTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="pf-field">
          <label>Furnishing *</label>
          <select
            name="furnishing_status"
            value={formData.furnishing_status}
            required
            onChange={handleChange}
          >
            {FURNISHING_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="pf-row pf-row-4">
        <div className="pf-field">
          <label>Bedrooms *</label>
          <input
            name="bedrooms"
            type="number"
            min="0"
            value={formData.bedrooms}
            required
            onChange={handleChange}
          />
        </div>
        <div className="pf-field">
          <label>Bathrooms *</label>
          <input
            name="bathrooms"
            type="number"
            min="0"
            value={formData.bathrooms}
            required
            onChange={handleChange}
          />
        </div>
        <div className="pf-field">
          <label>Area (sq ft) *</label>
          <input
            name="area_sqft"
            type="number"
            min="1"
            value={formData.area_sqft}
            required
            onChange={handleChange}
          />
        </div>
        <div className="pf-field">
          <label>Max Tenants *</label>
          <input
            name="max_tenants"
            type="number"
            min="1"
            value={formData.max_tenants}
            required
            onChange={handleChange}
          />
        </div>
      </div>
    </div>
    <div className="pf-section">
      <div className="pf-section-title">Financials</div>
      <div className="pf-row">
        <div className="pf-field">
          <label>Per period Rent (ETH) *</label>
          <input
            name="rent_amount"
            type="number"
            min="0"
            value={formData.rent_amount}
            required
            onChange={handleChange}
          />
        </div>
        <div className="pf-field">
          <label>Security Deposit (ETH) *</label>
          <input
            name="security_deposit"
            type="number"
            min="0"
            value={formData.security_deposit}
            required
            onChange={handleChange}
          />
        </div>
      </div>
      <div className="pf-row">
        <div className="pf-field">
          <label>Maintenance / period (ETH) *</label>
          <input
            name="maintenance_charge"
            type="number"
            min="0"
            value={formData.maintenance_charge}
            required
            onChange={handleChange}
          />
        </div>
      </div>
    </div>
    <div className="pf-section">
      <div className="pf-section-title">Terms & Conditions</div>
      <div className="pf-field">
        <textarea
          name="terms_and_conditions"
          placeholder="Optional rules or conditions..."
          value={formData.terms_and_conditions}
          onChange={handleChange}
          rows={3}
        />
      </div>
    </div>
    {setImages && <ImageUploadField images={images} setImages={setImages} />}
  </div>
);

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

const LandlordDashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [propertyTypes, setPropertyTypes] = useState([]);
  const [properties, setProperties] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [approvedRequests, setApprovedRequests] = useState([]);
  const [activeRequests, setActiveRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [walletAddress, setWalletAddress] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [profileFormData, setProfileFormData] = useState({
    username: "",
    phone: "",
  });
  const [actionLoading, setActionLoading] = useState({});
  const [activePropertyIds, setActivePropertyIds] = useState(new Set());
  const [agreementLoading, setAgreementLoading] = useState(false);
  const [newImages, setNewImages] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [leaseExpiredAgreements, setLeaseExpiredAgreements] = useState([]);
  const [reviewCompletedAgreements, setReviewCompletedAgreements] = useState(
    [],
  );
  const [reviewModal, setReviewModal] = useState(false);
  const [reviewRental, setReviewRental] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  // ── Raise Dispute ──
  const [raiseDisputeFor, setRaiseDisputeFor] = useState(null);

  const formatDate = (val) => {
    if (!val) return "N/A";
    const d = new Date(val);
    return isNaN(d.getTime()) ? "N/A" : d.toLocaleDateString();
  };
  const formatFurnishing = (val) => (val ? val.replace(/_/g, " ") : "N/A");

  useEffect(() => {
    fetchUserProfile();
    fetchProperties();
    fetchAllRequests();
    fetchPropertyTypes();
    loadWalletAddress();
    if (window.ethereum)
      window.ethereum.on("accountsChanged", (a) =>
        setWalletAddress(a.length === 0 ? null : a[0]),
      );
    return () => {
      if (window.ethereum?.removeListener)
        window.ethereum.removeListener("accountsChanged", () => {});
    };
  }, []);

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
      if (d.user.wallet_address) setWalletAddress(d.user.wallet_address);
      sessionStorage.setItem("user", JSON.stringify(d.user));
    } catch (err) {
      console.error(err);
    }
  };

  const fetchProperties = async () => {
    try {
      const d = await authFetch("/properties/my");
      setProperties(d.properties || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllRequests = async () => {
    try {
      const d = await authFetch("/rentals/my");
      const withDetails = await Promise.all(
        (d.rentals || []).map(async (r) => {
          try {
            const det = await authFetch(`/rentals/${r.id}`);
            return det.rental?.property_title ? det.rental : null; // ← null instead of r
          } catch {
            return null; // ← null instead of r
          }
        }),
      );
      const full = withDetails.filter(Boolean); // ← filter nulls
      setPendingRequests(full.filter((r) => r.status === "PENDING"));
      setApprovedRequests(full.filter((r) => r.status === "APPROVED"));
      setActiveRequests(
        full.filter(
          (r) => r.status === "ACTIVE" || r.status === "PENDING_DEPOSIT",
        ),
      );
      setLeaseExpiredAgreements(
        full.filter((r) => r.status === "LEASE_EXPIRED"),
      );
      setReviewCompletedAgreements(
        full.filter((r) => r.status === "REVIEW_COMPLETED"),
      );
      setActivePropertyIds(
        new Set(
          full
            .filter(
              (r) => r.status === "ACTIVE" || r.status === "PENDING_DEPOSIT",
            )
            .map((r) => r.property_id),
        ),
      );
    } catch {
      setPendingRequests([]);
      setApprovedRequests([]);
      setActiveRequests([]);
      setLeaseExpiredAgreements([]);
      setReviewCompletedAgreements([]);
    }
  };

  const fetchPropertyTypes = async () => {
    try {
      const d = await authFetch("/meta/property_types");
      setPropertyTypes(d.propertyTypes || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchNotifications = async () => {
    try {
      const d = await authFetch("/notifications");
      const parsed = (d.notifications || []).map((n) => ({
        ...n,
        metadata:
          typeof n.metadata === "string" ? JSON.parse(n.metadata) : n.metadata,
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
    const allRequests = [
      ...pendingRequests,
      ...approvedRequests,
      ...activeRequests,
      ...leaseExpiredAgreements,
      ...reviewCompletedAgreements,
    ];
    const rental = allRequests.find((r) => r.id === note.metadata.rental_id);
    if (!rental) return note.message;
    return `${note.message} — ${rental.property_title}`;
  };
  const handleNotificationClick = async (note) => {
    if (!note.is_read) {
      try {
        await authFetch(`/notifications/${note.id}/read`, { method: "PATCH" });
        setNotifications((prev) =>
          prev.map((n) => (n.id === note.id ? { ...n, is_read: true } : n)),
        );
      } catch (err) {
        console.error("Failed to mark notification as read:", err);
      }
    }

    if (note.metadata && note.metadata.rental_id) {
      const rentalId = note.metadata.rental_id;
      const allRequests = [
        ...pendingRequests,
        ...approvedRequests,
        ...activeRequests,
        ...leaseExpiredAgreements,
        ...reviewCompletedAgreements,
      ];
      const request = allRequests.find((r) => r.id === rentalId);
      if (request) {
        setSelectedRequest(request);
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
      alert("Please select a rating between 0 and 5.");
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
      fetchAllRequests();
    } catch (err) {
      alert(err.message);
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("role");
    sessionStorage.removeItem("user");
    navigate("/");
  };
  const handleChange = (e) =>
    setFormData({ ...formData, [e.target.name]: e.target.value });
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

  const handleAddProperty = async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData();
      Object.entries(formData).forEach(([key, value]) => fd.append(key, value));
      newImages.forEach((file) => fd.append("images", file));
      await authFetch("/properties/", { method: "POST", body: fd });
      alert("Property added!");
      setShowAddForm(false);
      setFormData(emptyForm);
      setNewImages([]);
      fetchProperties();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleEditClick = () => {
    setFormData({
      title: selectedProperty.title,
      description: selectedProperty.description || "",
      location: selectedProperty.location,
      city: selectedProperty.city || "",
      property_type_id: selectedProperty.property_type_id,
      rent_amount: selectedProperty.rent_amount,
      security_deposit: selectedProperty.security_deposit,
      maintenance_charge: selectedProperty.maintenance_charge,
      bedrooms: selectedProperty.bedrooms,
      bathrooms: selectedProperty.bathrooms,
      area_sqft: selectedProperty.area_sqft,
      max_tenants: selectedProperty.max_tenants,
      furnishing_status: selectedProperty.furnishing_status || "UNFURNISHED",
      terms_and_conditions: selectedProperty.terms_and_conditions || "",
    });
    setIsEditing(false);
  };

  const handleUpdateProperty = async (e) => {
    e.preventDefault();
    try {
      await authFetch(`/properties/${selectedProperty.id}`, {
        method: "PUT",
        body: JSON.stringify(formData),
      });
      alert("Updated!");
      setIsEditing(false);
      setSelectedProperty(null);
      setFormData(emptyForm);
      fetchProperties();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteProperty = async () => {
    if (!window.confirm("Delete this property?")) return;
    try {
      await authFetch(`/properties/${selectedProperty.id}`, {
        method: "DELETE",
      });
      alert("Deleted!");
      setSelectedProperty(null);
      fetchProperties();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRejectRequest = async (rentalId) => {
    if (!window.confirm("Reject this request?")) return;
    try {
      await authFetch(`/rentals/${rentalId}/reject`, { method: "PATCH" });
      alert("Rejected.");
      setSelectedRequest(null);
      fetchAllRequests();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleViewAgreement = async (rentalId) => {
    setAgreementLoading(true);
    try {
      const token = sessionStorage.getItem("token");
      const BASE_URL =
        import.meta.env.VITE_API_URL || "http://localhost:4000/api";
      const res = await fetch(
        `${BASE_URL}/rentals/${rentalId}/agreement/view`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
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

  const handleApproveGenerateAndSign = async (rentalId, rentalDetails) => {
    if (!walletAddress) {
      alert("Connect your MetaMask wallet first.");
      return;
    }
    setActionLoading((prev) => ({ ...prev, [`landlord_${rentalId}`]: true }));
    try {
      const message = [
        "RENTAL AGREEMENT SIGNATURE",
        "----------------------------",
        `Property: ${rentalDetails?.property_title || "N/A"}`,
        `Location: ${rentalDetails?.property_location || "N/A"}`,
        `Lease: ${rentalDetails?.lease_duration || "N/A"} minutes`,
        `Rent: Rs. ${rentalDetails?.rent_amount || "N/A"}`,
        `Deposit: Rs. ${rentalDetails?.security_deposit || "N/A"}`,
        `Role: Landlord`,
        `Date: ${new Date().toLocaleDateString()}`,
      ].join("\n");

      // Step 1: Ask landlord to review what they're signing
      alert(
        `Please review the rental details before signing:\n\n` +
          `Property: ${rentalDetails?.property_title || "N/A"}\n` +
          `Location: ${rentalDetails?.property_location || "N/A"}\n` +
          `Lease: ${rentalDetails?.lease_duration || "N/A"} minutes\n` +
          `Rent: ${rentalDetails?.rent_amount || "N/A"} ETH/minute\n` +
          `Deposit: ${rentalDetails?.security_deposit || "N/A"} ETH\n\n` +
          `MetaMask will now ask you to sign the agreement.`,
      );

      // Step 2: MetaMask sign
      const signature = await window.ethereum.request({
        method: "personal_sign",
        params: [message, walletAddress],
      });

      // Step 3: Generate agreement + store signature on backend
      await authFetch(`/rentals/${rentalId}/agreement/workflow`, {
        method: "PATCH",
        body: JSON.stringify({ signature, message }),
      });

      // Step 4: Open the generated PDF in a new tab
      await handleViewAgreement(rentalId);

      alert("✅ Agreement generated & signed! Waiting for tenant to sign.");
      setSelectedRequest(null);
      fetchAllRequests();
      fetchProperties();
    } catch (err) {
      if (err.code === 4001) alert("MetaMask signature rejected.");
      else alert("An unexpected blockchain error occurred. Please try again.");
      fetchAllRequests();
    } finally {
      setActionLoading((prev) => ({
        ...prev,
        [`landlord_${rentalId}`]: false,
      }));
    }
  };

  // ── Raise Dispute ──
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

  return (
    <div className="landlord-dashboard">
      <nav className="navbar">
        <div className="logo">🏠 Realtor</div>
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
          {/* ── Community Button ── */}
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
            <h2>My Properties</h2>
            <button className="add-btn" onClick={() => setShowAddForm(true)}>
              + Add Property
            </button>
          </div>
          <div className="column-section">
            <h3>Pending Requests</h3>
            {pendingRequests.length === 0 ? (
              <p className="no-items">No pending requests</p>
            ) : (
              <div className="column-items">
                {pendingRequests.map((req) => (
                  <div
                    key={req.id}
                    className="column-item-card"
                    onClick={() => setSelectedRequest(req)}
                  >
                    <h4>{req.tenant_name}</h4>
                    <p>{req.property_title}</p>
                    <p className="item-date">{formatDate(req.created_at)}</p>
                    <span className="status-badge pending">Pending</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="column-section">
            <h3>Awaiting Tenant Signature</h3>
            {approvedRequests.length === 0 ? (
              <p className="no-items">None waiting</p>
            ) : (
              <div className="column-items">
                {approvedRequests.map((req) => (
                  <div
                    key={req.id}
                    className="column-item-card"
                    onClick={() => setSelectedRequest(req)}
                  >
                    <h4>{req.tenant_name}</h4>
                    <p>{req.property_title}</p>
                    <p className="item-date">{formatDate(req.created_at)}</p>
                    <span className="status-badge approved">Approved</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="column-section">
            <h3>Active Rentals</h3>
            {activeRequests.length === 0 ? (
              <p className="no-items">No active rentals</p>
            ) : (
              <div className="column-items">
                {activeRequests.map((req) => (
                  <div
                    key={req.id}
                    className="column-item-card active-card"
                    onClick={() => setSelectedRequest(req)}
                  >
                    <h4>{req.tenant_name}</h4>
                    <p>{req.property_title}</p>
                    <p className="item-date">{formatDate(req.created_at)}</p>
                    <div className="card-bottom-row">
                      {req.status === "PENDING_DEPOSIT" ? (
                        <span className="status-badge pending">
                          ⏳ Deposit Pending
                        </span>
                      ) : (
                        <span className="status-badge active">Active</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="column-section">
            <h3>Lease Expired</h3>
            {leaseExpiredAgreements.length === 0 ? (
              <p className="no-items">No expired leases</p>
            ) : (
              <div className="column-items">
                {leaseExpiredAgreements.map((req) => (
                  <div
                    key={req.id}
                    className="column-item-card"
                    onClick={() => setSelectedRequest(req)}
                  >
                    <h4>{req.tenant_name}</h4>
                    <p>{req.property_title}</p>
                    <p className="item-date">{formatDate(req.created_at)}</p>
                    <div className="card-bottom-row">
                      {(user?.role === "TENANT" && !req.tenant_reviewed) ||
                      (user?.role === "LANDLORD" && !req.landlord_reviewed) ? (
                        <button
                          className="review-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            openReviewModal(req);
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
            {reviewCompletedAgreements.length === 0 ? (
              <p className="no-items">No reviewed rentals</p>
            ) : (
              <div className="column-items">
                {reviewCompletedAgreements.map((req) => (
                  <div
                    key={req.id}
                    className="column-item-card"
                    onClick={() => setSelectedRequest(req)}
                  >
                    <h4>{req.tenant_name}</h4>
                    <p>{req.property_title}</p>
                    <p className="item-date">{formatDate(req.created_at)}</p>
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
            <h2>All Properties</h2>
            <p className="property-count">
              {properties.length}{" "}
              {properties.length === 1 ? "property" : "properties"}
            </p>
          </div>
          {loading && <p className="loading-text">Loading...</p>}
          {!loading && properties.length === 0 && (
            <p className="empty-text">No properties added yet.</p>
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
                  {p.is_approved ? (
                    <span className="approved-badge">✅ Admin Approved</span>
                  ) : (
                    <span className="pending-approval-badge">
                      ⏳ Pending Admin Approval
                    </span>
                  )}
                  {activePropertyIds.has(p.id) && (
                    <div className="unavailable-overlay">
                      <span className="unavailable-label">Rented</span>
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
                    <p className="notification-message">
                      {enrichNotificationMessage(note)}
                    </p>
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
            <p>{reviewRental.property_title}</p>
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

      {/* ADD PROPERTY MODAL */}
      {showAddForm && (
        <div
          className="modal-overlay"
          onClick={() => {
            setShowAddForm(false);
            setNewImages([]);
          }}
        >
          <form
            className="modal property-form-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleAddProperty}
          >
            <div className="pf-modal-header">
              <div className="pf-modal-icon">🏠</div>
              <div>
                <h3>Add New Property</h3>
                <p>List your property</p>
              </div>
            </div>
            <PropertyFormFields
              formData={formData}
              handleChange={handleChange}
              propertyTypes={propertyTypes}
              images={newImages}
              setImages={setNewImages}
            />
            <div className="pf-modal-actions">
              <button type="submit" className="pf-submit-btn">
                ✓ List Property
              </button>
              <button
                type="button"
                className="pf-cancel-btn"
                onClick={() => {
                  setShowAddForm(false);
                  setNewImages([]);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* PROPERTY DETAILS MODAL */}
      {selectedProperty && !isEditing && (
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
                {Number(selectedProperty.rent_amount).toLocaleString()}{" "}
                ETH/minute
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
                  <b>Security Deposit:</b>{" "}
                  {Number(selectedProperty.security_deposit).toLocaleString()}{" "}
                  ETH
                </p>
                <p>
                  <b>Maintenance:</b>{" "}
                  {Number(selectedProperty.maintenance_charge).toLocaleString()}{" "}
                  ETH/minute
                </p>
                <p>
                  <b>Status:</b>{" "}
                  {selectedProperty.is_available ? "Available" : "Rented"}
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
              <div className="action-buttons">
                <button className="edit-btn" onClick={handleEditClick}>
                  ✏️ Edit
                </button>
                <button className="delete-btn" onClick={handleDeleteProperty}>
                  🗑️ Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT PROPERTY MODAL */}
      {selectedProperty && isEditing && (
        <div
          className="modal-overlay"
          onClick={() => {
            setIsEditing(false);
            setFormData(emptyForm);
          }}
        >
          <form
            className="modal property-form-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleUpdateProperty}
          >
            <div className="pf-modal-header">
              <div className="pf-modal-icon">✏️</div>
              <div>
                <h3>Edit Property</h3>
              </div>
            </div>
            <PropertyFormFields
              formData={formData}
              handleChange={handleChange}
              propertyTypes={propertyTypes}
            />
            <div className="pf-modal-actions">
              <button type="submit" className="pf-submit-btn">
                ✓ Update
              </button>
              <button
                type="button"
                className="pf-cancel-btn"
                onClick={() => {
                  setIsEditing(false);
                  setFormData(emptyForm);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* REQUEST DETAILS MODAL */}
      {selectedRequest && (
        <div className="modal-overlay" onClick={() => setSelectedRequest(null)}>
          <div className="property-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="close-btn"
              onClick={() => setSelectedRequest(null)}
            >
              ✕
            </button>
            <div className="modal-header">
              <h3>Rental Request</h3>
              <p className="location">{selectedRequest.property_title}</p>
              <span
                className={`status-badge-large ${selectedRequest.status.toLowerCase()}`}
              >
                {selectedRequest.status}
              </span>
            </div>
            <div className="modal-content">
              <div className="request-details-section">
                <h6>Tenant</h6>
                <p>
                  <b>Name:</b> {selectedRequest.tenant_name}
                </p>
                <p>
                  <b>Phone:</b> {selectedRequest.tenant_phone}
                </p>
              </div>
              <div className="request-details-section">
                <h6>Rental Details</h6>
                <p>
                  <b>Location:</b> {selectedRequest.property_location}
                  {selectedRequest.property_city
                    ? `, ${selectedRequest.property_city}`
                    : ""}
                </p>
                <p>
                  <b>Lease:</b> {selectedRequest.lease_duration} minutes
                  {selectedRequest.lease_duration !== 1 ? "s" : ""}
                </p>
                <p>
                  <b>Requested On:</b> {formatDate(selectedRequest.created_at)}
                </p>
                {selectedRequest.start_date && (
                  <p>
                    <b>Start Date:</b> {formatDate(selectedRequest.start_date)}
                  </p>
                )}
              </div>
              <div className="financial-info">
                <p>
                  <b>Rent:</b>{" "}
                  {Number(selectedRequest.rent_amount).toLocaleString()}
                  ETH/minute
                </p>
                <p>
                  <b>Deposit:</b>{" "}
                  {Number(selectedRequest.security_deposit).toLocaleString()}{" "}
                  ETH
                </p>
                <p>
                  <b>Maintenance:</b>{" "}
                  {Number(selectedRequest.maintenance_charge).toLocaleString()}{" "}
                  ETH/minute
                </p>
              </div>
              {selectedRequest.terms_and_conditions && (
                <div className="terms-section">
                  <p>
                    <b>Terms:</b>
                  </p>
                  <p className="terms-text">
                    {selectedRequest.terms_and_conditions}
                  </p>
                </div>
              )}

              {selectedRequest.status === "PENDING" && (
                <div className="action-buttons">
                  <button
                    className="approve-btn"
                    onClick={() =>
                      handleApproveGenerateAndSign(
                        selectedRequest.id,
                        selectedRequest,
                      )
                    }
                    disabled={actionLoading[`landlord_${selectedRequest.id}`]}
                  >
                    {actionLoading[`landlord_${selectedRequest.id}`]
                      ? "⏳ Processing..."
                      : "✍️ Generate & Sign Agreement"}
                  </button>
                  <button
                    className="reject-btn"
                    onClick={() => handleRejectRequest(selectedRequest.id)}
                    disabled={actionLoading[`landlord_${selectedRequest.id}`]}
                  >
                    ✕ Reject
                  </button>
                </div>
              )}

              {selectedRequest.status === "APPROVED" && (
                <div className="status-info approved">
                  <p>
                    ✅ Approved & signed. Waiting for tenant to sign and
                    activate.
                  </p>
                  <button
                    className="view-doc-btn"
                    onClick={() => handleViewAgreement(selectedRequest.id)}
                  >
                    👁 View Agreement
                  </button>
                </div>
              )}

              {selectedRequest.status === "PENDING_DEPOSIT" && (
                <div className="status-info pending">
                  <p>
                    ⏳ Both parties signed. Waiting for tenant to pay security
                    deposit.
                  </p>
                  <button
                    className="view-doc-btn"
                    onClick={() => handleViewAgreement(selectedRequest.id)}
                  >
                    👁 View Agreement
                  </button>
                </div>
              )}

              {selectedRequest.status === "ACTIVE" && (
                <div className="status-info active">
                  <p>✅ Rental is active. Both parties have signed.</p>
                  <button
                    className="view-doc-btn"
                    onClick={() => handleViewAgreement(selectedRequest.id)}
                  >
                    👁 View Agreement
                  </button>
                  {/* ── Raise Issue inside modal ── */}
                  <button
                    className="raise-issue-modal-btn"
                    onClick={() => {
                      setSelectedRequest(null);
                      setRaiseDisputeFor(selectedRequest);
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
    </div>
  );
};

export default LandlordDashboard;
