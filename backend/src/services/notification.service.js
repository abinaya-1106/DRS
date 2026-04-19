const isValidBasePayload = ({ userId, entityType, type, message }) => {
  if (!userId) return false;
  if (!entityType || !type || !message) return false;
  return true;
};

const fireAndForget = (promise, context) => {
  promise.catch((err) => {
    console.error(`[NOTIFY] ${context} failed:`, err?.message || err);
  });
};

// Non-blocking notification: never throws to caller.
// Business logic should continue even if notification insert fails.
export const notify = async (
  db,
  { userId, entityType, type, message, metadata = null },
) => {
  const payload = { userId, entityType, type, message };
  if (!isValidBasePayload(payload)) {
    console.warn("[NOTIFY] Skipping invalid notification payload", payload);
    return { queued: false };
  }

  fireAndForget(
    db.query(
      `INSERT INTO notifications (
            user_id,
            entity_type,
            type,
            message,
            metadata
        ) VALUES (?, ?, ?, ?, ?)`,
      [
        userId,
        entityType,
        type,
        message,
        metadata ? JSON.stringify(metadata) : null,
      ],
    ),
    "single notification insert",
  );

  return { queued: true };
};

// Non-blocking bulk notifications: never throws to caller.
export const notifyMany = async (db, notifications = []) => {
  if (!Array.isArray(notifications) || notifications.length === 0) {
    return { queued: false, queuedCount: 0 };
  }

  const validRows = notifications
    .filter((notif) => {
      const ok = isValidBasePayload(notif);
      if (!ok) {
        console.warn("[NOTIFY] Skipping invalid notification payload", {
          userId: notif?.userId,
          entityType: notif?.entityType,
          type: notif?.type,
        });
      }
      return ok;
    })
    .map((notif) => [
      notif.userId,
      notif.entityType,
      notif.type,
      notif.message,
      notif.metadata ? JSON.stringify(notif.metadata) : null,
    ]);

  if (validRows.length === 0) {
    return { queued: false, queuedCount: 0 };
  }

  fireAndForget(
    db.query(
      `INSERT INTO notifications (
            user_id,
            entity_type,
            type,
            message,
            metadata
        ) VALUES ?`,
      [validRows],
    ),
    "bulk notification insert",
  );

  return { queued: true, queuedCount: validRows.length };
};
