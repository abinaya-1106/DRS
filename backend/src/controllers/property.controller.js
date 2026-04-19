import pool from "../config/db.js";
import uploadImage from "../services/cloudinary.service.js";
import { notify } from "../services/notification.service.js";
import { ADMIN_USER_ID } from "../config/env.js";

const attachImageToProperties = async (properties) => {
  if (!properties || properties.length === 0) {
    return properties;
  }

  const propertyIds = properties.map((property) => property.id);

  const [imageRows] = await pool.query(
    `SELECT property_id, image_url, display_order
      FROM property_images
      WHERE property_id IN (?)
      ORDER BY property_id, display_order ASC`,
    [propertyIds],
  );

  const imagesByPropertyId = new Map();

  for (const row of imageRows) {
    const list = imagesByPropertyId.get(row.property_id) || [];

    list.push({
      image_url: row.image_url,
      display_order: row.display_order,
    });

    imagesByPropertyId.set(row.property_id, list);
  }

  return properties.map((property) => ({
    ...property, // spread operator to keep all existing property fields
    images: imagesByPropertyId.get(property.id) || [],
  }));
};

export const listAvailableProperties = async (req, res) => {
  try {
    const [results] = await pool.query(
      `SELECT
          p.id,
          p.title,
          p.description,

          p.location,
          p.city,

          pt.name AS property_type,

          p.rent_amount,
          p.security_deposit,
          p.maintenance_charge,

          p.bedrooms,
          p.bathrooms,
          p.area_sqft,

          p.max_tenants,

          p.furnishing_status,

          p.is_available,
          p.created_at,

          p.terms_and_conditions,
          p.rating,

          u.username AS landlord_name,
          u.phone AS landlord_phone
        FROM properties p
        JOIN users u ON p.landlord_id = u.id
        JOIN property_types pt ON p.property_type_id = pt.id
        WHERE p.is_available = true AND p.is_approved = true`, // only show properties that are approved by admin
    );

    const propertiesWithImages = await attachImageToProperties(results);

    res.status(200).json({ properties: propertiesWithImages });
  } catch (err) {
    console.error("Error fetching properties:", err);
    res.status(500).json({ message: "Database error" });
  }
};

export const searchAvailableProperties = async (req, res) => {
  const search = req.query.q?.toLowerCase().trim() || "";

  try {
    const [results] = await pool.query(
      `SELECT
          p.id,
          p.title,
          p.description,

          p.location,
          p.city,

          pt.name AS property_type,

          p.rent_amount,
          p.security_deposit,
          p.maintenance_charge,

          p.bedrooms,
          p.bathrooms,
          p.area_sqft,

          p.max_tenants,

          p.furnishing_status,

          p.is_available,
          p.created_at,

          p.terms_and_conditions,
          p.rating,

          u.username AS landlord_name,
          u.phone AS landlord_phone
        FROM properties p
        JOIN users u ON p.landlord_id = u.id
        JOIN property_types pt ON p.property_type_id = pt.id
        WHERE (
            LOWER(p.title) LIKE ? 
            OR LOWER(p.description) LIKE ? 
            OR LOWER(p.location) LIKE ?
            OR LOWER(p.city) LIKE ?
            OR LOWER(pt.name) LIKE ?
        )
            AND p.is_available = true
            AND p.is_approved = true
		`,
      [
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
      ],
    );

    const propertiesWithImages = await attachImageToProperties(results);

    res.status(200).json({ properties: propertiesWithImages });
  } catch (err) {
    console.error("Error searching properties:", err);
    res.status(500).json({ message: "Database error" });
  }
};

export const createProperty = async (req, res) => {
  const userId = req.user.id;
  const {
    title,
    description,
    location,
    city,
    property_type_id,
    rent_amount,
    security_deposit,
    maintenance_charge,
    bedrooms,
    bathrooms,
    area_sqft,
    max_tenants,
    furnishing_status,
    terms_and_conditions,
  } = req.body || {}; // empty fields should be handled by frontend, but we still validate on backend

  // Basic validation to prevent undefined/null values from being inserted into the database
  const requiredFields = {
    title,
    location,
    city,
    property_type_id,
    rent_amount,
    security_deposit,
    maintenance_charge,
    bedrooms,
    bathrooms,
    area_sqft,
    max_tenants,
    furnishing_status,
  };

  const missingFields = Object.entries(requiredFields)
    .filter(([, value]) => value == null) // catches both undefined and null
    .map(([key]) => key);

  if (missingFields.length > 0) {
    return res.status(400).json({
      message: "Missing required fields",
      missingFields,
    });
  }

  // Basic server-side validation for required fields
  const errors = {};

  // Validate title
  if (!title || typeof title !== "string" || !title.trim()) {
    errors.title = "Title is required and must be a non-empty string.";
  }

  // Description can be optional, but if provided, it should be a string
  if (description !== undefined && description !== null) {
    if (typeof description !== "string") {
      errors.description = "Description must be a string.";
    }
  }

  // Validate location
  if (!location || typeof location !== "string" || !location.trim()) {
    errors.location = "Location is required and must be a non-empty string.";
  }

  // Validate city
  if (!city || typeof city !== "string" || !city.trim()) {
    errors.city = "City is required and must be a non-empty string.";
  }

  // validate property_type_id
  const propertyTypeIdValue =
    typeof property_type_id === "string"
      ? Number(property_type_id)
      : property_type_id;

  // Check if property_type_id is a valid number and positive integer
  if (
    Number.isNaN(propertyTypeIdValue) ||
    !Number.isFinite(propertyTypeIdValue)
  ) {
    errors.property_type_id =
      "Property type ID is required and must be a valid number.";
  } else if (propertyTypeIdValue <= 0) {
    errors.property_type_id = "Property type ID must be a positive integer.";
  } else {
    // Check if the provided property_type_id exists in the database
    try {
      const [propertyTypes] = await pool.query(
        "SELECT id FROM property_types WHERE id = ?",
        [propertyTypeIdValue],
      );
      if (propertyTypes.length === 0) {
        errors.property_type_id = "Provided property type ID does not exist.";
      }
    } catch (err) {
      console.error("Error validating property type:", err);
      return res.status(500).json({ message: "Database error" });
    }
  }

  // Validate rent_amount
  const rentAmountValue =
    typeof rent_amount === "string" ? Number(rent_amount) : rent_amount;

  if (Number.isNaN(rentAmountValue) || !Number.isFinite(rentAmountValue)) {
    errors.rent_amount = "Rent amount is required and must be a valid number.";
  } else if (rentAmountValue <= 0) {
    errors.rent_amount = "Rent amount must be a positive number.";
  }

  // Validate security_deposit
  const securityDepositValue =
    typeof security_deposit === "string"
      ? Number(security_deposit)
      : security_deposit;

  if (
    Number.isNaN(securityDepositValue) ||
    !Number.isFinite(securityDepositValue)
  ) {
    errors.security_deposit = "Security deposit must be a valid number.";
  } else if (securityDepositValue < 0) {
    errors.security_deposit = "Security deposit cannot be negative.";
  }

  // Validate maintenance_charge
  const maintenanceChargeValue =
    typeof maintenance_charge === "string"
      ? Number(maintenance_charge)
      : maintenance_charge;

  if (
    Number.isNaN(maintenanceChargeValue) ||
    !Number.isFinite(maintenanceChargeValue)
  ) {
    errors.maintenance_charge = "Maintenance charge must be a valid number.";
  } else if (maintenanceChargeValue < 0) {
    errors.maintenance_charge = "Maintenance charge cannot be negative.";
  }

  // Validate bedrooms
  const bedroomsValue =
    typeof bedrooms === "string" ? Number(bedrooms) : bedrooms;

  if (Number.isNaN(bedroomsValue) || !Number.isFinite(bedroomsValue)) {
    errors.bedrooms = "Bedrooms is required and must be a valid number.";
  } else if (bedroomsValue < 0) {
    errors.bedrooms = "Bedrooms cannot be negative.";
  }

  // Validate bathrooms
  const bathroomsValue =
    typeof bathrooms === "string" ? Number(bathrooms) : bathrooms;

  if (Number.isNaN(bathroomsValue) || !Number.isFinite(bathroomsValue)) {
    errors.bathrooms = "Bathrooms is required and must be a valid number.";
  } else if (bathroomsValue < 0) {
    errors.bathrooms = "Bathrooms cannot be negative.";
  }

  // Validate area_sqft
  const areaSqftValue =
    typeof area_sqft === "string" ? Number(area_sqft) : area_sqft;

  if (Number.isNaN(areaSqftValue) || !Number.isFinite(areaSqftValue)) {
    errors.area_sqft = "Area (sqft) is required and must be a valid number.";
  } else if (areaSqftValue <= 0) {
    errors.area_sqft = "Area (sqft) must be a positive number.";
  }

  // Validate max_tenants
  const maxTenantsValue =
    typeof max_tenants === "string" ? Number(max_tenants) : max_tenants;

  if (Number.isNaN(maxTenantsValue) || !Number.isFinite(maxTenantsValue)) {
    errors.max_tenants = "Max tenants is required and must be a valid number.";
  } else if (maxTenantsValue <= 0) {
    errors.max_tenants = "Max tenants must be a positive integer.";
  }

  // Validate furnishing_status
  const validFurnishingStatuses = [
    "UNFURNISHED",
    "SEMI_FURNISHED",
    "FULLY_FURNISHED",
  ];

  if (
    !furnishing_status ||
    typeof furnishing_status !== "string" ||
    !validFurnishingStatuses.includes(furnishing_status.toUpperCase())
  ) {
    errors.furnishing_status =
      "Furnishing status is required and must be one of UNFURNISHED, SEMI_FURNISHED, or FULLY_FURNISHED.";
  }

  if (terms_and_conditions !== undefined && terms_and_conditions !== null) {
    if (typeof terms_and_conditions !== "string") {
      errors.terms_and_conditions = "Terms and conditions must be a string.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      message: "Validation error",
      errors,
    });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [insertedProperty] = await conn.query(
      `INSERT INTO properties (
            landlord_id,
            title,
            description,
            location,
            city,
            property_type_id,
            rent_amount,
            security_deposit,
            maintenance_charge,
            bedrooms,
            bathrooms,
            area_sqft,
            max_tenants,
            furnishing_status,
            terms_and_conditions
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        title,
        description,
        location,
        city,
        propertyTypeIdValue,
        rentAmountValue + maintenanceChargeValue, // total rent amount includes maintenance charge
        securityDepositValue,
        maintenanceChargeValue,
        bedroomsValue,
        bathroomsValue,
        areaSqftValue,
        maxTenantsValue,
        furnishing_status,
        terms_and_conditions,
      ],
    );

    if (insertedProperty.affectedRows === 0) {
      await conn.rollback();
      return res.status(400).json({ message: "Failed to add property" });
    }

    const files = Array.isArray(req.files) ? req.files : [];

    for (let imageIndex = 0; imageIndex < files.length; imageIndex++) {
      const file = files[imageIndex];
      const result = await uploadImage(file, insertedProperty.insertId);

      const [insertedPropertyImage] = await conn.query(
        "INSERT INTO property_images (property_id, image_url, public_id, display_order) VALUES (?, ?, ?, ?)",
        [
          insertedProperty.insertId,
          result.secure_url,
          result.public_id,
          imageIndex,
        ],
      );

      if (insertedPropertyImage.affectedRows === 0) {
        await conn.rollback();
        return res
          .status(400)
          .json({ message: "Failed to save property image" });
      }
    }

    // Notify the admin about the new property
    await notify(conn, {
      userId: ADMIN_USER_ID,
      entityType: "PROPERTY",
      type: "NEW_PROPERTY_ADDED",
      message: "A new property has been added.",
      metadata: {
        property_id: insertedProperty.insertId,
      },
    });

    await conn.commit();
    res.status(201).json({ message: "Property added successfully" });
  } catch (err) {
    await conn.rollback();
    console.error("Error adding property:", err);
    res.status(500).json({ message: "Error while adding property" });
  }
};

export const listLandlordProperties = async (req, res) => {
  const userId = req.user.id;

  try {
    const [results] = await pool.query(
      `SELECT
          p.id,
          p.landlord_id,

          p.title,
          p.description,
          p.location,
          p.city,

          p.property_type_id,
          pt.name AS property_type,

          p.rent_amount,
          p.security_deposit,
          p.maintenance_charge,

          p.bedrooms,
          p.bathrooms,
          p.area_sqft,

          p.max_tenants,

          p.furnishing_status,

          p.is_available,
          p.is_approved,

          p.terms_and_conditions,
          p.rating,

          p.created_at,
          p.updated_at
        FROM properties as p
        JOIN property_types pt ON p.property_type_id = pt.id
        WHERE p.landlord_id = ?`,
      [userId],
    );

    const propertiesWithImages = await attachImageToProperties(results);

    res.status(200).json({ properties: propertiesWithImages });
  } catch (err) {
    console.error("Error fetching landlord properties:", err);
    res.status(500).json({
      message: "Error while fetching landlord properties",
    });
  }
};

export const updateProperty = async (req, res) => {
  const userId = req.user.id;
  const propertyId = req.params.id;
  const newData = req.body || {}; // IMPORTANT: body must follow the property schema

  try {
    // Check if the property exists and belongs to the landlord
    const [properties] = await pool.query(
      "SELECT 1 FROM properties WHERE id = ? AND landlord_id = ?",
      [propertyId, userId],
    );

    if (properties.length === 0) {
      return res.status(404).json({ message: "Property not found" });
    }

    // Update the property with new data
    const fields = [];
    const values = [];

    Object.entries(newData).forEach(([key, value]) => {
      fields.push(`${key} = ?`);
      values.push(value);
    });

    if (fields.length === 0) {
      return res.status(400).json({ message: "No data provided for update" });
    }

    values.push(propertyId);

    const [updateResult] = await pool.query(
      `UPDATE properties SET ${fields.join(", ")} WHERE id = ?`,
      values,
    );

    if (updateResult.affectedRows === 0) {
      return res.status(400).json({ message: "Failed to update property" });
    }

    res.status(200).json({ message: "Property updated successfully" });
  } catch (err) {
    console.error("Error updating property:", err);
    res.status(500).json({ message: "Database error" });
  }
};

export const deleteProperty = async (req, res) => {
  const userId = req.user.id;
  const propertyId = req.params.id;

  try {
    // Check if the property exists and belongs to the landlord
    const [properties] = await pool.query(
      "SELECT 1 FROM properties WHERE id = ? AND landlord_id = ?",
      [propertyId, userId],
    );

    if (properties.length === 0) {
      return res.status(404).json({ message: "Property not found" });
    }

    const [agreements] = await pool.query(
      "SELECT 1 FROM rental_agreements WHERE property_id = ? AND status NOT IN ('REJECTED', 'COMPLETED')",
      [propertyId],
    );

    if (agreements.length > 0) {
      return res.status(400).json({
        message:
          "Cannot delete property with active or approved or pending rental agreements",
      });
    }

    // Delete the property
    const [deleteResult] = await pool.query(
      "DELETE FROM properties WHERE id = ?",
      [propertyId],
    );

    if (deleteResult.affectedRows === 0) {
      return res.status(400).json({ message: "Failed to delete property" });
    }

    res.status(200).json({ message: "Property deleted successfully" });
  } catch (err) {
    console.error("Error deleting property:", err);
    res.status(500).json({ message: "Database error" });
  }
};

export const listAllPropertiesForAdmin = async (req, res) => {
  try {
    const [results] = await pool.query(
      `SELECT
          p.id,
          p.title,
          p.description,

          p.location,
          p.city,

          pt.name AS property_type,

          p.rent_amount,
          p.security_deposit,
          p.maintenance_charge,

          p.bedrooms,
          p.bathrooms,
          p.area_sqft,

          p.max_tenants,

          p.furnishing_status,

          p.is_available,
          p.is_approved,

          p.created_at,
          p.updated_at,

          p.terms_and_conditions,
          p.rating,

          u.username AS landlord_name,
          u.phone AS landlord_phone
        FROM properties p
        JOIN users u ON p.landlord_id = u.id
        JOIN property_types pt ON p.property_type_id = pt.id
        ORDER BY p.is_approved ASC, p.created_at DESC`,
    );

    const propertiesWithImages = await attachImageToProperties(results);

    res.status(200).json({ properties: propertiesWithImages });
  } catch (err) {
    console.error("Error fetching all properties for admin:", err);
    res.status(500).json({ message: "Database error" });
  }
};

export const approveProperty = async (req, res) => {
  const propertyId = req.params.id;

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [[property]] = await conn.query(
      `SELECT id, landlord_id, title
        FROM properties 
        WHERE id = ? AND is_approved = false
        FOR UPDATE`,
      [propertyId],
    );

    if (!property) {
      await conn.rollback();
      return res.status(404).json({ message: "Property not found to approve" });
    }

    const [updateResult] = await conn.query(
      `UPDATE properties
        SET is_approved = true
        WHERE id = ?`,
      [property.id],
    );

    if (updateResult.affectedRows === 0) {
      await conn.rollback();
      return res.status(400).json({ message: "Failed to approve property" });
    }

    await notify(conn, {
      userId: property.landlord_id,
      entityType: "PROPERTY",
      type: "ADMIN_PROPERTY_APPROVED",
      message: `Your property "${property.title}" has been approved by the admin.`,
      metadata: {
        property_id: property.id,
      },
    });

    await conn.commit();

    res.status(200).json({ message: "Property approved successfully" });
  } catch (err) {
    await conn.rollback();
    console.error("Error approving property:", err);
    res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
};

export const rejectProperty = async (req, res) => {
  const propertyId = req.params.id;

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [[property]] = await conn.query(
      `SELECT landlord_id, title
        FROM properties
        WHERE id = ? AND is_approved = false`,
      [propertyId],
    );

    if (!property) {
      await conn.rollback();
      return res.status(404).json({ message: "Property not found to reject" });
    }

    const [deleteResult] = await conn.query(
      `DELETE FROM properties
        WHERE id = ?`,
      [propertyId],
    );

    if (deleteResult.affectedRows === 0) {
      await conn.rollback();
      return res.status(400).json({ message: "Failed to delete property" });
    }

    await notify(conn, {
      userId: property.landlord_id,
      entityType: "PROPERTY",
      type: "ADMIN_PROPERTY_REJECTED",
      message: `Your property "${property.title}" has been rejected by the admin and deleted.`,
      metadata: {
        property_id: property.id,
      },
    });

    await conn.commit();

    res
      .status(200)
      .json({ message: "Property rejected and deleted successfully" });
  } catch (err) {
    await conn.rollback();
    console.error("Error rejecting property:", err);
    res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
};
