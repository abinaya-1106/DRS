import cloudinary from "../config/cloudinary.config.js";

const uploadImage = async (file, property_id) => {
  const result = await cloudinary.uploader.upload(
    `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
    { folder: `property_images/${property_id}` },
  );
  return result;
};

export default uploadImage;
