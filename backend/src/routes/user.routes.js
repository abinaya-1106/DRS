import express from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import { validateFields } from "../middlewares/validation.middileware.js";
import { editUserProfile } from "../controllers/user.controller.js";

const router = express.Router();
router.use(authenticateToken); // All routes require authentication

// route to edit user profile (username, phone)
router.put("/edit", validateFields(["username", "phone"]), editUserProfile);

export default router;
