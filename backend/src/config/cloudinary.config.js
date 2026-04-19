import { v2 as cloudinary } from "cloudinary";
import { CLOUDINARY_CONFIG } from "./env.js";

cloudinary.config({
  cloud_name: CLOUDINARY_CONFIG.CLOUD_NAME,
  api_key: CLOUDINARY_CONFIG.API_KEY,
  api_secret: CLOUDINARY_CONFIG.API_SECRET,
});

export default cloudinary;
