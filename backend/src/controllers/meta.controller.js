import pool from "../config/db.js";

export const getPropertyTypes = async (req, res) => {
  try {
    const [types] = await pool.query("SELECT * FROM property_types");
    res.status(200).json({ propertyTypes: types });
  } catch (err) {
    console.error("Error fetching property types:", err);
    res.status(500).json({
      message: "Server error fetching property types",
    });
  }
};
