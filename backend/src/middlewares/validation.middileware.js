import {
  isValidEmail,
  isValidPhone,
  isValidRole,
} from "../utils/validators.js";

export const validateFields = (requiredFields) => {
  return (req, res, next) => {
    req.body = req.body || {};

    // Check for missing fields
    const missingFields = requiredFields.filter(
      (field) => !(field in req.body) || !req.body[field]?.trim(),
    );
    if (missingFields.length > 0) {
      return res
        .status(400)
        .json({ message: `Missing fields: ${missingFields.join(", ")}` });
    }

    // Trim string fields
    requiredFields.forEach((field) => {
      if (typeof req.body[field] === "string") {
        req.body[field] = req.body[field].trim();
      }
    });

    // Email validation
    if (requiredFields.includes("email")) {
      if (!isValidEmail(req.body.email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }
      req.body.email = req.body.email.toLowerCase();
    }

    // Phone validation
    if (requiredFields.includes("phone") && !isValidPhone(req.body.phone)) {
      return res.status(400).json({ message: "Invalid phone number format" });
    }

    // Role validation
    if (requiredFields.includes("role") && !isValidRole(req.body.role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    // Address validation can be added here if needed, but since we're using signature verification for authentication, we can rely on that for validating wallet addresses.

    // Add more field-specific validations as needed, such as password strength, username validation, etc.

    next();
  };
};
