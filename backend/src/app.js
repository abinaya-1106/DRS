import express from "express";
import cors from "cors";

const app = express();
app.use(cors({ origin: "http://localhost:5173", credentials: true }));

app.use(express.json());

// Json parsing error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON format" });
  }
  next(err); // Pass to next error handler if it's not a JSON parsing error
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled application error:", err);
  res.status(err.status || 500).json({
    error: "Internal Server Error",
  });
});

import authRoutes from "./routes/auth.routes.js";
import disputeRoutes from "./routes/dispute.routes.js";
import metaRoutes from "./routes/meta.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import propertyRoutes from "./routes/property.routes.js";
import rentalRoutes from "./routes/rental.routes.js";
import userRoutes from "./routes/user.routes.js";

app.use("/api/auth", authRoutes);
app.use("/api/disputes", disputeRoutes);
app.use("/api/meta", metaRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/rentals", rentalRoutes);
app.use("/api/users", userRoutes);

import "./jobs/rental.job.js";
import "./jobs/dispute.job.js";

app.get("/", (req, res) => {
  res.send("Welcome to the Decentralised Rental System API");
});

export default app;
