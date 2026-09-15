/**
 * Idempotency utilities for financial operations
 */

const { pool } = require("../config/database");

/**
 * Check if a payment has already been processed
 */
const isPaymentAlreadyProcessed = async (zapupiOrderId) => {
  const result = await pool.query(
    `SELECT id, status, zapupi_payment_id 
     FROM wallet_topup_orders 
     WHERE zapupi_order_id = $1`,
    [zapupiOrderId],
  );

  if (result.rows.length === 0) {
    return { processed: false };
  }

  const order = result.rows[0];
  const isProcessed = ["successful", "failed", "refunded"].includes(
    order.status,
  );

  return {
    processed: isProcessed,
    order,
  };
};

/**
 * Check if order exists and is owned by user
 */
const verifyOrderOwnership = async (zapupiOrderId, userId) => {
  const result = await pool.query(
    `SELECT id, status, amount_minor, currency, user_id
     FROM wallet_topup_orders
    WHERE zapupi_order_id = $1`,
    [zapupiOrderId],
  );

  if (result.rows.length === 0) {
    return { valid: false, error: "Order not found" };
  }

  const order = result.rows[0];

  if (order.user_id !== userId) {
    return { valid: false, error: "User does not own this order" };
  }

  return { valid: true, order };
};

/**
 * Generate a unique reference
 */
const generateReference = (prefix = "TOPUP") => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}_${timestamp}_${random}`;
};

/**
 * Generate a unique transaction reference
 */
const generateTransactionReference = () => {
  return generateReference("TXN");
};

module.exports = {
  isPaymentAlreadyProcessed,
  verifyOrderOwnership,
  generateReference,
  generateTransactionReference,
};
