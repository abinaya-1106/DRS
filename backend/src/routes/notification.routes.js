import express from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import {
  listAllNotifications,
  readNotification,
} from "../controllers/notification.controller.js";

const router = express.Router();
router.use(authenticateToken);

router.get("/", listAllNotifications);

router.patch("/:id/read", readNotification);

export default router;
