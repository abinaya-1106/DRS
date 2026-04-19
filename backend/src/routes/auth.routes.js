import express from "express";
import {
  authenticateToken,
  attachUserIfAuthenticated,
} from "../middlewares/auth.middleware.js";
import { validateFields } from "../middlewares/validation.middileware.js";
import {
  getNonce,
  getProfile,
  logoutUser,
  registerWithMetamask,
  loginWithMetamask,
} from "../controllers/auth.controller.js";

const router = express.Router();

// get logged-in user profile
router.get("/me", authenticateToken, getProfile);

// logout route (optional, mostly handled client-side)
router.post("/logout", authenticateToken, logoutUser);

// route to get nonce for signing
router.get("/nonce", getNonce);

// registration route for web3 wallet authentication
router.post(
  "/register",
  attachUserIfAuthenticated,
  validateFields([
    "address",
    "signedMessage",
    "message",
    "role",
    "username",
    "phone",
  ]),
  registerWithMetamask,
);

// login route for web3 wallet authentication
router.post(
  "/login",
  attachUserIfAuthenticated,
  validateFields(["address", "signedMessage", "message"]),
  loginWithMetamask,
);

export default router;
