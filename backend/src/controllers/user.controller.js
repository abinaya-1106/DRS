import { isValidPhone } from "../utils/validators.js";
import pool from "../config/db.js";

export const editUserProfile = async (req, res) => {
  const userId = req.user.id;
  const { username, phone } = req.body;

  try {
    if (!username?.trim() || !phone?.trim() || !isValidPhone(phone)) {
      return res.status(400).json({
        message: "Username and phone number are required and must be valid",
      });
    }

    // phone number is unique and not null, so we need to check if the new phone number already exists for another user
    const [existing] = await pool.query(
      "SELECT 1 FROM users WHERE phone = ? AND id != ?",
      [phone, userId],
    );

    if (existing.length > 0) {
      return res.status(409).json({ message: "Phone number already exists" });
    }

    const [updateResult] = await pool.query(
      "UPDATE users SET username = ?, phone = ? WHERE id = ?",
      [username, phone, userId],
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ message: "Profile updated successfully" });
  } catch (err) {
    console.error("Error updating profile:", err);
    res.status(500).json({
      message: "Server error updating profile",
    });
  }
};
