import dotenv from "dotenv";

dotenv.config();

export const DB_CONFIG = {
  HOST: process.env.DB_HOST || "localhost",
  USER: process.env.DB_USER || "root",
  PASSWORD: process.env.DB_PASSWORD || "",
  DATABASE: process.env.DB_DATABASE || "rental_system",
};

export const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

export const PORT = process.env.PORT || 4000;

export const BLOCKCHAIN_CONFIG = {
  RPC_URL: process.env.RPC_URL,
  PRIVATE_KEY: process.env.PRIVATE_KEY,
};

export const PINATA_CONFIG = {
  API_KEY: process.env.PINATA_API_KEY,
  API_SECRET: process.env.PINATA_API_SECRET,
};

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export const CLOUDINARY_CONFIG = {
  CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  API_KEY: process.env.CLOUDINARY_API_KEY,
  API_SECRET: process.env.CLOUDINARY_API_SECRET,
};

export const RENT_INTERVAL_SECONDS = process.env.RENT_INTERVAL_SECONDS
  ? parseInt(process.env.RENT_INTERVAL_SECONDS)
  : 60; // Default to 1 minute for testing

export const DEPOSIT_TIMEOUT_SECONDS = process.env.DEPOSIT_TIMEOUT_SECONDS
  ? parseInt(process.env.DEPOSIT_TIMEOUT_SECONDS)
  : 900; // Default to 15 minutes for testing

export const REVIEW_TIMEOUT_SECONDS = process.env.REVIEW_TIMEOUT_SECONDS
  ? parseInt(process.env.REVIEW_TIMEOUT_SECONDS)
  : 900; // Default to 15 minutes for testing

export const RENT_DUE_NOTIFICATION_SECONDS = process.env
  .RENT_DUE_NOTIFICATION_SECONDS
  ? parseInt(process.env.RENT_DUE_NOTIFICATION_SECONDS)
  : 60; // Default to 1 minute for testing

export const VOTING_DURATION_SECONDS = process.env.VOTING_DURATION_SECONDS
  ? parseInt(process.env.VOTING_DURATION_SECONDS)
  : 900; // Default to 15 minutes for testing

export const ADMIN_USER_ID = process.env.ADMIN_USER_ID
  ? parseInt(process.env.ADMIN_USER_ID)
  : 1; // Default to user ID 1 for admin
