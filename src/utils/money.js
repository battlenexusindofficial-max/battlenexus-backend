/**
 * Money Utilities
 * All amounts stored in minor units (paise for INR)
 * ₹1 = 100 paise
 */

const CURRENCY_MINOR_UNITS = {
  INR: 100,
};

/**
 * Convert rupees to minor units (paise)
 */
const toMinor = (amountInRupees, currency = "INR") => {
  const minorUnit = CURRENCY_MINOR_UNITS[currency];
  if (!minorUnit) {
    throw new Error(`Unsupported currency: ${currency}`);
  }
  return Math.round(amountInRupees * minorUnit);
};

const decimalToMinor = (amount, currency = "INR") => {
  const minorUnit = CURRENCY_MINOR_UNITS[currency];
  if (!minorUnit || !/^\d+(\.\d{1,2})?$/.test(String(amount))) {
    throw new Error("Invalid monetary amount");
  }

  const [whole, fraction = ""] = String(amount).split(".");
  return Number(whole) * minorUnit + Number(fraction.padEnd(2, "0"));
};

/**
 * Convert minor units to rupees
 */
const toRupees = (amountInMinor, currency = "INR") => {
  const minorUnit = CURRENCY_MINOR_UNITS[currency];
  if (!minorUnit) {
    throw new Error(`Unsupported currency: ${currency}`);
  }
  return amountInMinor / minorUnit;
};

/**
 * Validate amount is a valid integer in minor units
 */
const validateMinorAmount = (amountInMinor) => {
  if (!Number.isInteger(amountInMinor)) {
    return { valid: false, error: "Amount must be an integer" };
  }
  if (amountInMinor < 0) {
    return { valid: false, error: "Amount cannot be negative" };
  }
  return { valid: true };
};

/**
 * Format amount for display
 */
const formatAmount = (amountInRupees, currency = "INR") => {
  const symbol = currency === "INR" ? "₹" : currency;
  return `${symbol}${amountInRupees.toLocaleString("en-IN")}`;
};

module.exports = {
  toMinor,
  decimalToMinor,
  toRupees,
  validateMinorAmount,
  formatAmount,
  CURRENCY_MINOR_UNITS,
};
