// Email validation helper
export const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Phone number validation helper (simple regex for demonstration, can be improved later)
export function isValidPhone(phone) {
  // Accepts +91XXXXXXXXXX or XXXXXXXXXX
  const phoneRegex = /^(\+91)?[6-9]\d{9}$/;
  return phoneRegex.test(phone);
}

// Role validation helper
export function isValidRole(role) {
  const validRoles = ["tenant", "landlord", "admin"];
  return validRoles.includes(role);
}

// Add more validators as needed, such as password strength, username validation, etc.
