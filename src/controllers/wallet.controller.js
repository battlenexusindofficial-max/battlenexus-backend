// battlenexus-backend/src/controllers/wallet.controller.js

const { pool } = require("../config/database");
const { toMinor, toRupees } = require("../utils/money");
const { generateReference } = require("../utils/idempotency");
const {
  createOrder,
  getOrderStatus,
  validateTopupAmount,
  ALLOWED_TOPUP_AMOUNTS,
  MIN_TOPUP_AMOUNT,
  MAX_TOPUP_AMOUNT,
  isSuccessfulPaymentStatus,
} = require("../services/zapupi.service");
const {
  processTopup,
  recordFailedTopup,
} = require("../services/walletTopup.service");
const { logger } = require("../utils/logger");

// ============================================================
// GET TOPUP CONFIG
// ============================================================

const getTopupConfig = async (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      minAmount: MIN_TOPUP_AMOUNT,
      maxAmount: MAX_TOPUP_AMOUNT,
      quickAmounts: ALLOWED_TOPUP_AMOUNTS,
    },
  });
};

// ============================================================
// CREATE TOPUP ORDER
// ============================================================

const createTopupOrder = async (req, res) => {
  try {
    const { amount, currency = "INR" } = req.body;
    const userId = req.user.id;

    const amountValidation = validateTopupAmount(amount);
    if (!amountValidation.valid) {
      return res
        .status(400)
        .json({ success: false, error: amountValidation.error });
    }

    const userResult = await pool.query(
      `SELECT email, display_name FROM users WHERE id = $1`,
      [userId],
    );
    const user = userResult.rows[0] || {};

    const amountInMinor = toMinor(amount, currency);
    const reference = generateReference("TOPUP");
    const paymentReturnUrl = "battlenexus://wallet";

    const orderResult = await createOrder(amountInMinor, currency, reference, {
      mobile: user.phone || undefined,
      remark: `Wallet Topup | uid:${userId}`,
      webhookUrl: `${process.env.BACKEND_URL}/api/webhooks/zapupi`,
      successUrl: `${paymentReturnUrl}?payment=success&order_id=${encodeURIComponent(reference)}`,
      failedUrl: `${paymentReturnUrl}?payment=failed&order_id=${encodeURIComponent(reference)}`,
    });

    if (!orderResult.success) {
      return res.status(500).json({ success: false, error: orderResult.error });
    }

    const order = orderResult.order;

    await pool.query(
      `INSERT INTO wallet_topup_orders
        (user_id, reference, zapupi_order_id, amount_minor, currency, status, environment)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        reference,
        order.id,
        amountInMinor,
        currency,
        "pending",
        process.env.ZAPUPI_MODE || "test",
      ],
    );

    return res.status(200).json({
      success: true,
      data: {
        orderId: order.id,
        amount: amountInMinor,
        currency,
        reference,
        paymentUrl: order.payment_url,
      },
    });
  } catch (error) {
    logger.error("CREATE_ORDER_ERROR", { error: error.message });
    return res
      .status(500)
      .json({ success: false, error: "Failed to create top-up order" });
  }
};

// ============================================================
// VERIFY TOPUP
// ============================================================

const verifyTopup = async (req, res) => {
  try {
    const { order_id } = req.body;
    const userId = req.user.id;
    const firebaseUid = req.user.firebase_uid;

    if (!order_id) {
      return res
        .status(400)
        .json({ success: false, error: "Missing order_id" });
    }

    const orderResult = await pool.query(
      `SELECT id, user_id, amount_minor, currency, status,
              zapupi_order_id, reference
         FROM wallet_topup_orders
        WHERE reference = $1 OR zapupi_order_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [order_id],
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const order = orderResult.rows[0];

    if (order.user_id !== userId) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    const verify = await getOrderStatus(order.zapupi_order_id);

    if (!verify.success) {
      logger.warn("VERIFY_ZAPUPI_FAILED", {
        orderId: order_id,
        error: verify.error,
      });
      return res.status(400).json({
        success: false,
        error: verify.error || "Could not verify with ZapUPI",
      });
    }

    const p = verify.payment;
    if (!isSuccessfulPaymentStatus(p.status)) {
      return res.status(400).json({
        success: false,
        error: `Payment not completed (status: ${p.status})`,
      });
    }

    if (p.order_id !== order.zapupi_order_id) {
      return res
        .status(400)
        .json({ success: false, error: "Provider order mismatch" });
    }

    if (process.env.NODE_ENV === "production" && p.environment === "test") {
      return res
        .status(400)
        .json({ success: false, error: "Test payments not allowed" });
    }

    const result = await processTopup({
      zapupiOrderId: order.zapupi_order_id,
      zapupiTransactionId: p.txn_id,
      zapupiPaymentId: p.utr || p.txn_id,
      userId,
      firebaseUid,
      amountInMinor: order.amount_minor,
      verifiedAmount: p.amount,
      providerStatus: p.status,
      providerEnvironment: p.environment,
      utr: p.utr,
      currency: order.currency,
      isWebhook: false,
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    return res.status(200).json({
      success: true,
      data: {
        status: "successful",
        transactionId: result.transactionId,
        balanceAfter: result.balanceAfter,
        alreadyProcessed: result.alreadyProcessed || false,
      },
    });
  } catch (error) {
    logger.error("VERIFY_PAYMENT_ERROR", { error: error.message });
    return res
      .status(500)
      .json({ success: false, error: "Failed to verify payment" });
  }
};

// ============================================================
// CHECK PAYMENT STATUS (polling)
// ============================================================

const checkPaymentStatus = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");

    const { orderId } = req.params;
    const userId = req.user.id;

    const orderResult = await pool.query(
      `SELECT id, user_id, status, reference, zapupi_order_id,
              amount_minor, currency
         FROM wallet_topup_orders
        WHERE reference = $1 OR zapupi_order_id = $1
        LIMIT 1`,
      [orderId],
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    if (orderResult.rows[0].user_id !== userId) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    if (
      ["successful", "failed", "refunded"].includes(orderResult.rows[0].status)
    ) {
      if (orderResult.rows[0].status === "failed") {
        await recordFailedTopup({
          zapupiOrderId: orderResult.rows[0].zapupi_order_id,
          userId,
          providerStatus: "failed",
          reason: "Payment was not completed by ZapUPI",
        });
      }
      return res.status(200).json({
        success: true,
        data: { status: orderResult.rows[0].status },
      });
    }

    const verify = await getOrderStatus(orderResult.rows[0].zapupi_order_id);

    if (!verify.success) {
      return res.status(200).json({
        success: true,
        data: { status: orderResult.rows[0].status },
      });
    }

    const order = orderResult.rows[0];
    const providerStatus = String(verify.payment.status || "").toLowerCase();

    if (
      isSuccessfulPaymentStatus(providerStatus) &&
      verify.payment.order_id === order.zapupi_order_id &&
      verify.payment.txn_id
    ) {
      const userResult = await pool.query(
        `SELECT firebase_uid FROM users WHERE id = $1`,
        [order.user_id],
      );
      const firebaseUid = userResult.rows[0]?.firebase_uid;

      if (!firebaseUid) {
        return res.status(200).json({
          success: true,
          data: { status: "pending" },
        });
      }

      const processed = await processTopup({
        zapupiOrderId: order.zapupi_order_id,
        zapupiTransactionId: verify.payment.txn_id,
        zapupiPaymentId: verify.payment.utr || verify.payment.txn_id,
        userId: order.user_id,
        firebaseUid,
        amountInMinor: order.amount_minor,
        verifiedAmount: verify.payment.amount,
        providerStatus: verify.payment.status,
        providerEnvironment: verify.payment.environment,
        utr: verify.payment.utr,
        currency: order.currency,
        isWebhook: false,
      });

      if (processed.success) {
        return res.status(200).json({
          success: true,
          data: {
            status: "successful",
            transactionId: processed.transactionId,
            amount: verify.payment.amount,
            alreadyProcessed: processed.alreadyProcessed || false,
          },
        });
      }

      logger.warn("CHECK_STATUS_PROCESSING_PENDING", {
        orderId,
        error: processed.error,
      });
    }

    if (
      ["failed", "cancelled", "canceled", "expired", "timeout"].includes(
        providerStatus,
      )
    ) {
      await recordFailedTopup({
        zapupiOrderId: order.zapupi_order_id,
        userId: order.user_id,
        providerStatus: verify.payment.status,
        reason: "Payment was not completed by ZapUPI",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        status: verify.payment.status,
        transactionId: verify.payment.txn_id,
        amount: verify.payment.amount,
      },
    });
  } catch (error) {
    logger.error("CHECK_STATUS_ERROR", { error: error.message });
    return res
      .status(500)
      .json({ success: false, error: "Failed to check status" });
  }
};

// ============================================================
// RECONCILE PENDING TOP-UPS
// ============================================================

const reconcilePendingTopups = async (req, res) => {
  try {
    const userId = req.user.id;
    const firebaseUid = req.user.firebase_uid;
    const pendingOrders = await pool.query(
      `SELECT id, user_id, amount_minor, currency, zapupi_order_id
         FROM wallet_topup_orders
        WHERE user_id = $1
          AND (
            status IN ('pending', 'processing')
            OR (
              status = 'successful'
              AND NOT EXISTS (
                SELECT 1
                  FROM wallet_transactions t
                 WHERE t.zapupi_order_id = wallet_topup_orders.zapupi_order_id
              )
            )
          )
        ORDER BY created_at DESC
        LIMIT 10`,
      [userId],
    );

    const results = [];
    for (const order of pendingOrders.rows) {
      const verify = await getOrderStatus(order.zapupi_order_id);
      if (!verify.success) {
        results.push({ orderId: order.zapupi_order_id, status: "pending" });
        continue;
      }

      const providerStatus = String(verify.payment.status || "")
        .trim()
        .toLowerCase();

      if (
        isSuccessfulPaymentStatus(providerStatus) &&
        verify.payment.order_id === order.zapupi_order_id &&
        verify.payment.txn_id
      ) {
        const processed = await processTopup({
          zapupiOrderId: order.zapupi_order_id,
          zapupiTransactionId: verify.payment.txn_id,
          zapupiPaymentId: verify.payment.utr || verify.payment.txn_id,
          userId,
          firebaseUid,
          amountInMinor: order.amount_minor,
          verifiedAmount: verify.payment.amount,
          providerStatus: verify.payment.status,
          providerEnvironment: verify.payment.environment,
          utr: verify.payment.utr,
          currency: order.currency,
          isWebhook: false,
        });
        results.push({
          orderId: order.zapupi_order_id,
          status: processed.success ? "successful" : "pending",
        });
        continue;
      }

      if (
        ["failed", "cancelled", "canceled", "expired", "timeout"].includes(
          providerStatus,
        )
      ) {
        await recordFailedTopup({
          zapupiOrderId: order.zapupi_order_id,
          userId,
          providerStatus: verify.payment.status,
          reason: "Payment was not completed by ZapUPI",
        });
      }
      results.push({
        orderId: order.zapupi_order_id,
        status: providerStatus || "pending",
      });
    }

    return res.status(200).json({ success: true, data: results });
  } catch (error) {
    logger.error("RECONCILE_TOPUPS_ERROR", { error: error.message });
    return res
      .status(500)
      .json({ success: false, error: "Failed to reconcile payments" });
  }
};

// ============================================================
// GET WALLET BALANCE
// ============================================================

const getWalletBalance = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT balance_minor, currency FROM wallets WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res
        .status(200)
        .json({ success: true, balance: 0, currency: "INR" });
    }

    return res.status(200).json({
      success: true,
      balance: toRupees(result.rows[0].balance_minor),
      currency: result.rows[0].currency,
    });
  } catch (error) {
    logger.error("GET_BALANCE_ERROR", { error: error.message });
    return res
      .status(500)
      .json({ success: false, error: "Failed to get balance" });
  }
};

// ============================================================
// GET TRANSACTIONS
// ============================================================

const getTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `SELECT id, type, direction, amount_minor, currency,
              status, provider_reference, reference,
              balance_before_minor, balance_after_minor, created_at
         FROM wallet_transactions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    const totalResult = await pool.query(
      `SELECT COUNT(*) FROM wallet_transactions WHERE user_id = $1`,
      [userId],
    );

    return res.status(200).json({
      success: true,
      transactions: result.rows.map((row) => ({
        id: row.id,
        type: row.type,
        direction: row.direction,
        amount: toRupees(row.amount_minor),
        currency: row.currency,
        status: row.status,
        reference: row.reference,
        balanceBefore: toRupees(row.balance_before_minor),
        balanceAfter: toRupees(row.balance_after_minor),
        createdAt: row.created_at,
      })),
      total: parseInt(totalResult.rows[0].count),
      limit,
      offset,
    });
  } catch (error) {
    logger.error("GET_TRANSACTIONS_ERROR", { error: error.message });
    return res
      .status(500)
      .json({ success: false, error: "Failed to get transactions" });
  }
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  createTopupOrder,
  verifyTopup,
  checkPaymentStatus,
  reconcilePendingTopups,
  getWalletBalance,
  getTransactions,
  getTopupConfig,
};
