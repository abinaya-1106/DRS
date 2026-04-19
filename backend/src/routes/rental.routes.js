import express from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import {
  applyForRental,
  cancelRentalRequest,
  rejectRentalRequest,
  listRentals,
  getRentalDetails,
  getRentalRentDues,
  processAgreementWorkflow,
  viewAgreement,
  confirmRentPayment,
  submitRentalRating,
} from "../controllers/rental.controller.js";

const router = express.Router();
router.use(authenticateToken); // All routes require authentication

// ----- tenant actions -----

// Route for tenants to rent a property
router.post("/apply", authorizeRole(["TENANT"]), applyForRental);

// Route for tenant to confirm a rent payment
router.post("/:id/rent/confirm", authorizeRole(["TENANT"]), confirmRentPayment);

// Route for tenant to cancel the rental request while it's still pending
router.delete("/:id/cancel", authorizeRole(["TENANT"]), cancelRentalRequest);

// ----- landlord actions -----

// Reject rental request
router.patch("/:id/reject", authorizeRole(["LANDLORD"]), rejectRentalRequest);

// ----- shared routes -----

// both tenant and landlord can view their rentals in this route, frontend can filter based on rental status if needed
router.get("/my", authorizeRole(["TENANT", "LANDLORD"]), listRentals);

// Route to view rental agreement details (must be last to avoid matching "/my" as :id)
router.get("/:id", authorizeRole(["TENANT", "LANDLORD"]), getRentalDetails);

// Route to get rent dues from blockchain for a rental
router.get(
  "/:id/rent/dues",
  authorizeRole(["TENANT", "LANDLORD"]),
  getRentalRentDues,
);

// Unified agreement workflow route:
// - LANDLORD: generate agreement (if missing) + sign
// - TENANT: sign + deploy OR confirm deposit (via txHash)
router.patch(
  "/:id/agreement/workflow",
  authorizeRole(["TENANT", "LANDLORD"]),
  processAgreementWorkflow,
);

// Route to view rental agreement by landlord and tenant
router.get(
  "/:id/agreement/view",
  authorizeRole(["TENANT", "LANDLORD"]),
  viewAgreement,
);

// Route for rating/review after lease expires
router.post(
  "/:id/review",
  authorizeRole(["TENANT", "LANDLORD"]),
  submitRentalRating,
);

export default router;
