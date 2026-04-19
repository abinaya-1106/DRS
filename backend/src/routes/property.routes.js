import express from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import {
  listAvailableProperties,
  searchAvailableProperties,
  createProperty,
  listLandlordProperties,
  updateProperty,
  deleteProperty,
  listAllPropertiesForAdmin,
  approveProperty,
  rejectProperty,
} from "../controllers/property.controller.js";
import upload from "../middlewares/multer.middleware.js";

const router = express.Router();
router.use(authenticateToken); // All routes require authentication

// ----- tenant facing -----

// Route for tenants to list all properties
router.get("/", authorizeRole(["TENANT"]), listAvailableProperties);

// Route for tenants to search properties
router.get("/search", authorizeRole(["TENANT"]), searchAvailableProperties);

// ----- landlord facing -----

// Route for landlords to add new properties
router.post(
  "/",
  authorizeRole(["LANDLORD"]),
  upload.array("images"),
  createProperty,
);

// Route for landlords to view their own properties
router.get("/my", authorizeRole(["LANDLORD"]), listLandlordProperties);

// Route for landlords to update their property details
router.put("/:id", authorizeRole(["LANDLORD"]), updateProperty);

// Route for landlords to delete their property
router.delete("/:id", authorizeRole(["LANDLORD"]), deleteProperty);

// ------ admin facing -----

router.get("/admin/all", authorizeRole(["ADMIN"]), listAllPropertiesForAdmin);

// Route for admin to approve property
router.patch("/approve/:id", authorizeRole(["ADMIN"]), approveProperty);

// Route for admin to reject property
router.patch("/reject/:id", authorizeRole(["ADMIN"]), rejectProperty);

export default router;
