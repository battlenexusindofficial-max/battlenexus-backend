// battlenexus-backend/src/controllers/webhook.controller.js

const { pool } = require("../config/database");
const {
  getOrderStatus,
  normalizeWebhook,
  isExpectedEnvironment,
  isSuccessfulPaymentStatus,
} = require("../services/zapupi.service");
const {
  processTopup,
  recordFailedTopup,
} = require("../services/walletTopup.service");
const { logger } = require("../utils/logger");

const handleZapUPIWebhook = async (req, res) => {
  const ok = () => res.status(200).json({ status: "ok" });

  try {
    const payload = normalizeWebhook(req.body);
    const metadata = {
      orderId: payload.order_id || undefined,
      transactionId: payload.txn_id || undefined,
      webhookStatus: payload.status || undefined,
    };
    if (!payload.order_id || !payload.status) {
      logger.warn("WEBHOOK_INVALID_PAYLOAD", metadata);
      return res.status(400).json({ status: "error" });
    }

    if (isSuccessfulPaymentStatus(payload.status) && !payload.txn_id) {
      logger.warn("WEBHOOK_INVALID_PAYLOAD", {
        ...metadata,
        reason: "missing transaction ID",
      });
      return res.status(400).json({ status: "error" });
    }

    if (!isExpectedEnvironment(payload.environment)) {
      logger.warn("WEBHOOK_ENVIRONMENT_MISMATCH", {
        ...metadata,
        receivedEnvironment: payload.environment,
      });
      return ok();
    }

    // Record the event before doing slow verification. Replayed provider events
    // are acknowledged without repeating logs or payment work.
    try {
      const eventResult = await pool.query(
        `INSERT INTO webhook_events (webhook_id, event_type, payload, signature_valid)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (webhook_id) DO NOTHING
         RETURNING id`,
        [
          payload.txn_id || payload.order_id,
          `payment.${payload.status.toLowerCase()}`,
          req.body,
          false,
        ],
      );
      if (eventResult.rows.length === 0) {
        return ok();
      }
      logger.info("WEBHOOK_RECEIVED", metadata);
    } catch (e) {
      logger.warn("WEBHOOK_LOG_FAILED", { error: e.message });
    }

    // Look up order
    const orderRow = await pool.query(
      `SELECT id, user_id, status, amount_minor, currency, zapupi_order_id
         FROM wallet_topup_orders
        WHERE zapupi_order_id = $1 OR reference = $1
        LIMIT 1`,
      [payload.order_id],
    );

    if (orderRow.rows.length === 0) {
      logger.warn("WEBHOOK_ORDER_NOT_FOUND", { orderId: payload.order_id });
      return ok();
    }

    const dbOrder = orderRow.rows[0];

    const normalizedStatus = payload.status.toLowerCase();
    if (
      ["failed", "cancelled", "canceled", "expired", "timeout"].includes(
        normalizedStatus,
      )
    ) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const lockedOrder = await client.query(
          `SELECT status FROM wallet_topup_orders WHERE id = $1 FOR UPDATE`,
          [dbOrder.id],
        );
        if (lockedOrder.rows[0]?.status === "pending") {
          await client.query(
            `UPDATE wallet_topup_orders
                SET status = 'failed', provider_status = $1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $2`,
            [payload.status, dbOrder.id],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      await recordFailedTopup({
        zapupiOrderId: dbOrder.zapupi_order_id,
        userId: dbOrder.user_id,
        providerStatus: payload.status,
        reason: "Payment was not completed by ZapUPI",
      });
      return ok();
    }

    if (!isSuccessfulPaymentStatus(payload.status)) {
      return ok();
    }

    if (dbOrder.status === "successful") {
      logger.info("WEBHOOK_ALREADY_PROCESSED", {
        orderId: payload.order_id,
      });
      return ok();
    }

    // Double confirm via order-status
    logger.info("WEBHOOK_VERIFICATION_REQUEST", metadata);
    const verify = await getOrderStatus(dbOrder.zapupi_order_id);
    if (!verify.success) {
      logger.warn("WEBHOOK_REVERIFY_FAILED", {
        ...metadata,
        error: verify.error,
      });
      return ok();
    }

    logger.info("WEBHOOK_VERIFICATION_RESULT", {
      ...metadata,
      verifiedStatus: verify.payment.status,
    });

    if (
      verify.payment.order_id !== dbOrder.zapupi_order_id ||
      !isSuccessfulPaymentStatus(verify.payment.status) ||
      verify.payment.txn_id !== payload.txn_id ||
      !isExpectedEnvironment(verify.payment.environment)
    ) {
      logger.warn("WEBHOOK_VERIFICATION_MISMATCH", metadata);
      return ok();
    }

    // Get firebase uid
    const userRow = await pool.query(
      `SELECT firebase_uid FROM users WHERE id = $1`,
      [dbOrder.user_id],
    );
    if (userRow.rows.length === 0) return ok();
    const firebaseUid = userRow.rows[0].firebase_uid;

    // Credit wallet
    const result = await processTopup({
      zapupiOrderId: dbOrder.zapupi_order_id,
      zapupiTransactionId: verify.payment.txn_id,
      zapupiPaymentId: verify.payment.utr || verify.payment.txn_id,
      userId: dbOrder.user_id,
      firebaseUid,
      amountInMinor: dbOrder.amount_minor,
      verifiedAmount: verify.payment.amount,
      providerStatus: verify.payment.status,
      providerEnvironment: verify.payment.environment,
      utr: verify.payment.utr,
      currency: dbOrder.currency,
      isWebhook: true,
    });

    if (result.success) {
      logger.info("WEBHOOK_PROCESSED", metadata);
      await pool.query(
        `UPDATE webhook_events
            SET processed = true, signature_valid = true,
                processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE webhook_id = $1`,
        [payload.txn_id || payload.order_id],
      );
    } else {
      logger.error("WEBHOOK_PROCESS_FAILED", {
        ...metadata,
        error: result.error,
      });
      if (result.error === "Payment amount mismatch") {
        logger.warn("WEBHOOK_AMOUNT_MISMATCH", metadata);
      }
    }

    return ok();
  } catch (error) {
    logger.error("WEBHOOK_ERROR", { error: error.message });
    return ok();
  }
};

module.exports = { handleZapUPIWebhook };
