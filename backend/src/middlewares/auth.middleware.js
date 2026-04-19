import { JWT_SECRET } from "../config/env.js";
import jwt from "jsonwebtoken";

// Middleware to authenticate JWT token
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(401).json({ message: "Authorization header missing" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Attach decoded token to request
    next(); // Proceed to the next middleware or route handler
  } catch (err) {
    console.error("JWT verification error:", err);
    return res.status(403).json({ message: "Invalid or expired token" });
  }
};

// Optional auth middleware: if a valid token is provided, attach user to req.user.
// Useful for routes that should behave differently when user is already logged in.
export const attachUserIfAuthenticated = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return next();
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    console.error("JWT optional verification error:", err);
    return res.status(403).json({ message: "Invalid or expired token" });
  }
};

// in future we can add more auth related middlewares here like refresh token
