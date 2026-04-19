import express from "express";
import { getPropertyTypes } from "../controllers/meta.controller.js";

const router = express.Router();

// Route to get all property types for dropdowns and filters
router.get("/property_types", getPropertyTypes);

export default router;
