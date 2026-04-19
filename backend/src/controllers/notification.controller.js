import pool from "../config/db.js";

export const listAllNotifications = async (req, res) => {
  const userId = req.user.id;

  try {
    const [result] = await pool.query(
      `SELECT
          id,
          user_id,
          entity_type,
          type,
          message,
          metadata,
          is_read,
          created_at
        FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC`,
      [userId],
    );

    res.status(200).json({ notifications: result });
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ message: "Server error fetching notifications" });
  }
};

export const readNotification = async (req, res) => {
  const userId = req.user.id;
  const notificationId = req.params.id;

  try {
    const [result] = await pool.query(
      `UPDATE notifications
        SET is_read = 1
        WHERE id = ? AND user_id = ?`,
      [notificationId, userId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.status(200).json({ message: "Notification marked as read" });
  } catch (err) {
    console.error("Error marking notification as read:", err);
    res
      .status(500)
      .json({ message: "Server error marking notification as read" });
  }
};
