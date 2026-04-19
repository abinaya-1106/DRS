import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import { JWT_SECRET } from "../config/env.js";
import crypto from "crypto";
import { ethers } from "ethers";

export const getProfile = async (req, res) => {
  const userId = req.user.id;

  try {
    const [[user]] = await pool.query(
      `SELECT
          id,
          username,
          wallet_address,
          phone,
          role,
          trust_score
        FROM users
        WHERE id = ?
        LIMIT 1`,
      [userId],
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ user });
  } catch (err) {
    console.error("Error fetching user profile:", err);
    res.status(500).json({
      message: "Server error fetching user profile",
    });
  }
};

export const logoutUser = async (req, res) => {
  // Since JWTs are stateless, logout can be handled on the client side by simply deleting the token.
  res.status(200).json({ message: "Logout successful" });
};

export const getNonce = async (req, res) => {
  const nonce = crypto.randomBytes(32).toString("hex");
  res.status(200).json({ nonce });
};

export const registerWithMetamask = async (req, res) => {
  if (req.user) {
    return res.status(409).json({ message: "User already logged in" });
  }

  const { address, signedMessage, message, role, username, phone } = req.body;

  try {
    const signerAddress = ethers.verifyMessage(message, signedMessage);

    if (signerAddress.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ message: "Signature verification failed" });
    }

    try {
      await pool.query(
        "INSERT INTO users (wallet_address, username, phone, role) VALUES (?, ?, ?, ?)",
        [address, username, phone, role],
      );
    } catch (dbErr) {
      // Handle potential race conditions when two requests attempt to register the same wallet
      if (dbErr && (dbErr.code === "ER_DUP_ENTRY" || dbErr.errno === 1062)) {
        return res.status(400).json({
          message: "Wallet address or phone number already registered", // as wallet_address and phone have unique constraints, this error can occur if either is duplicated
        });
      }
      throw dbErr;
    }
    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    console.error("Error during registration:", err);
    res.status(500).json({
      message: "Server error during registration",
    });
  }
};

export const loginWithMetamask = async (req, res) => {
  if (req.user) {
    return res.status(409).json({ message: "User already logged in" });
  }

  const { address, signedMessage, message } = req.body;

  try {
    const signerAddress = ethers.verifyMessage(message, signedMessage);

    if (signerAddress.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ message: "Signature verification failed" });
    }

    const [[user]] = await pool.query(
      "SELECT id, username, role FROM users WHERE wallet_address = ? LIMIT 1",
      [address],
    );

    if (!user) {
      return res
        .status(404)
        .json({ message: "User not found. Please register first." });
    }

    const token = jwt.sign(
      { id: user.id, address, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" },
    );

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        username: user.username,
        address,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Error during login:", err);
    res.status(500).json({
      message: "Server error during login",
    });
  }
};
