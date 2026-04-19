import express from "express";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import {
  createDispute,
  updateAiDecisionResponse,
  getDisputes,
  voteDispute,
} from "../controllers/dispute.controller.js";

const router = express.Router();
router.use(authenticateToken);

// Route for tenants and landlords to raise a dispute
router.post("/raise", authorizeRole(["TENANT", "LANDLORD"]), createDispute);

// Route for tenants and landlords to accept/reject AI decision on a dispute
router.patch(
  "/:id/ai-decision",
  authorizeRole(["TENANT", "LANDLORD"]),
  updateAiDecisionResponse,
);

// Route to view disputes
router.get("/", getDisputes);

// Route for eligible users to vote on a dispute
router.post("/:id/vote", voteDispute);

export default router;
