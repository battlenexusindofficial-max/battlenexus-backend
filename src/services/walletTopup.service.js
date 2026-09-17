// battlenexus-backend/src/services/walletTopup.service.js

const { pool } = require("../config/database");
const { generateTransactionReference } = require("../utils/idempotency");
const { logger } = require("../utils/logger");
const { decimalToMinor } = require("../utils/money");
const {
  isExpectedEnvironment,
  isSuccessfulPaymentStatus,
} = require("./zapupi.service");
const { updateWalletBalance, addTransaction } = require("./firebase.service");

const syncFirebaseTopup = async ({
  firebaseUid,
  amount,
  status,
  balanceAfter,
  transactionId,
  description,
}) => {
  if (!firebaseUid) {
    throw new Error("Firebase UID is missing; wallet sync was not performed");
  }

  try {
    await updateWalletBalance(firebaseUid, balanceAfter);
    await addTransaction({
      uid: firebaseUid,
      title: status === "SUCCESS" ? "Wallet Top-up" : "Wallet Top-up Failed",
      subtitle:
        status === "SUCCESS" ? "ZapUPI payment" : "ZapUPI payment failed",
      amount,
      type: "deposit",
      status,
      source: "ZAPUPI",
      balanceAfter,
      requestId: `zapupi_${transactionId}`,
      documentId: `zapupi_${transactionId}`,
      description,
    });
  } catch (error) {
    logger.error("FIREBASE_TOPUP_SYNC_ERROR", {
      firebaseUid,
      transactionId,
      error: error.message,
    });
    throw error;
  }
};

const processTopup = async ({
  zapupiOrderId,
  zapupiTransactionId,
  zapupiPaymentId,
  userId,
  firebaseUid,
  amountInMinor,
  verifiedAmount,
  providerStatus,
  providerEnvironment,
  utr,
  currency,
  isWebhook = false,
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Step 1: Check idempotency
    const existingOrder = await client.query(
      `SELECT id, status, user_id, amount_minor
         FROM wallet_topup_orders
        WHERE zapupi_order_id = $1
        FOR UPDATE`,
      [zapupiOrderId],
    );

    if (existingOrder.rows.length === 0) {
      await client.query("ROLLBACK");
      return { success: false, error: "Order not found" };
    }

    const order = existingOrder.rows[0];

    if (order.user_id !== userId) {
      await client.query("ROLLBACK");
      return { success: false, error: "Order user mismatch" };
    }

    if (verifiedAmount !== undefined) {
      if (!isSuccessfulPaymentStatus(providerStatus)) {
        await client.query("ROLLBACK");
        return { success: false, error: "Payment is not successful" };
      }
      if (!isExpectedEnvironment(providerEnvironment)) {
        await client.query("ROLLBACK");
        return { success: false, error: "Payment environment mismatch" };
      }
      if (
        decimalToMinor(String(verifiedAmount), currency) !== order.amount_minor
      ) {
        await client.query("ROLLBACK");
        return { success: false, error: "Payment amount mismatch" };
      }
    }

    if (order.status === "successful") {
      const txnResult = await client.query(
        `SELECT id, amount_minor, balance_after_minor
           FROM wallet_transactions
          WHERE reference = $1 OR provider_reference = $2
          LIMIT 1`,
        [order.id.toString(), zapupiTransactionId],
      );

      const existingTransaction = txnResult.rows[0];
      if (existingTransaction) {
        await client.query("COMMIT");
        await syncFirebaseTopup({
          firebaseUid,
          amount:
            (existingTransaction.amount_minor || order.amount_minor) / 100,
          status: "SUCCESS",
          balanceAfter: (existingTransaction.balance_after_minor || 0) / 100,
          transactionId: existingTransaction.id || zapupiTransactionId,
          description: "ZapUPI payment already processed",
        });

        return {
          success: true,
          alreadyProcessed: true,
          transactionId: existingTransaction.id,
          balanceAfter: existingTransaction.balance_after_minor / 100,
        };
      }

      // A manually marked successful order has no ledger entry yet.
      // Re-open the transaction and let the verified payment create it.
      await client.query("ROLLBACK");
      await client.query("BEGIN");
    }

    if (order.status === "failed" || order.status === "refunded") {
      await client.query("ROLLBACK");
      return { success: false, error: `Order is already ${order.status}` };
    }

    if (!zapupiTransactionId) {
      await client.query("ROLLBACK");
      return { success: false, error: "Missing provider transaction ID" };
    }

    const duplicateTransaction = await client.query(
      `SELECT id FROM wallet_transactions
        WHERE zapupi_transaction_id = $1 OR provider_reference = $2
        LIMIT 1`,
      [zapupiTransactionId, zapupiPaymentId],
    );
    if (duplicateTransaction.rows.length > 0) {
      await client.query("ROLLBACK");
      return { success: false, error: "Provider transaction already used" };
    }

    // Step 2: Get or create wallet
    let walletResult = await client.query(
      `SELECT id, balance_minor FROM wallets WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );

    if (walletResult.rows.length === 0) {
      walletResult = await client.query(
        `INSERT INTO wallets (user_id, balance_minor, currency)
         VALUES ($1, 0, $2)
         RETURNING id, balance_minor`,
        [userId, currency],
      );
    }

    const wallet = walletResult.rows[0];
    const balanceBefore = wallet.balance_minor;
    const balanceAfter = balanceBefore + amountInMinor;

    // Step 3: Update wallet
    await client.query(
      `UPDATE wallets SET balance_minor = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [balanceAfter, wallet.id],
    );

    // Step 4: Insert transaction record
    const transactionRef = generateTransactionReference();

    const txnResult = await client.query(
      `INSERT INTO wallet_transactions (
        user_id, wallet_id, type, direction, amount_minor, currency,
        status, provider, provider_reference, zapupi_order_id,
        zapupi_transaction_id, reference, balance_before_minor,
        balance_after_minor, metadata
      ) VALUES (
        $1, $2, 'topup', 'credit', $3, $4,
        'completed', 'zapupi', $5, $6,
        $7, $8, $9, $10, $11
      ) RETURNING id`,
      [
        userId,
        wallet.id,
        amountInMinor,
        currency,
        zapupiTransactionId,
        zapupiOrderId,
        zapupiPaymentId,
        transactionRef,
        balanceBefore,
        balanceAfter,
        JSON.stringify({
          source: isWebhook ? "webhook" : "verify",
          firebaseUid,
        }),
      ],
    );

    const transactionId = txnResult.rows[0].id;

    // Step 5: Update order status
    await client.query(
      `UPDATE wallet_topup_orders
          SET status = 'successful',
              zapupi_payment_id = $1,
              zapupi_utr = $2,
              provider_status = $3,
              processed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $4`,
      [zapupiPaymentId, utr || null, providerStatus || "Success", order.id],
    );

    await client.query("COMMIT");

    await syncFirebaseTopup({
      firebaseUid,
      amount: amountInMinor / 100,
      status: "SUCCESS",
      balanceAfter: balanceAfter / 100,
      transactionId,
      description: "Wallet credited after ZapUPI payment verification",
    });

    logger.info("TOPUP_PROCESSED", {
      userId,
      firebaseUid,
      zapupiOrderId,
      transactionId,
      amountInMinor,
      balanceAfter,
    });

    return {
      success: true,
      transactionId,
      balanceAfter: balanceAfter / 100,
      alreadyProcessed: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error("PROCESS_TOPUP_ERROR", {
      userId,
      zapupiOrderId,
      error: error.message,
    });
    return {
      success: false,
      error: error.message || "Failed to process top-up",
    };
  } finally {
    client.release();
  }
};

const recordFailedTopup = async ({
  zapupiOrderId,
  userId,
  providerStatus,
  reason,
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const orderResult = await client.query(
      `SELECT o.id, o.user_id, o.amount_minor, o.currency, o.status,
              u.firebase_uid
         FROM wallet_topup_orders o
         JOIN users u ON u.id = o.user_id
        WHERE o.zapupi_order_id = $1
        FOR UPDATE`,
      [zapupiOrderId],
    );

    if (orderResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return { success: false, error: "Order not found" };
    }

    const order = orderResult.rows[0];
    if (order.user_id !== userId) {
      await client.query("ROLLBACK");
      return { success: false, error: "Order user mismatch" };
    }

    const existingTransaction = await client.query(
      `SELECT id
         FROM wallet_transactions
        WHERE zapupi_order_id = $1
          AND status = 'failed'
        LIMIT 1`,
      [zapupiOrderId],
    );

    if (existingTransaction.rows.length > 0) {
      await client.query("COMMIT");
      return {
        success: true,
        alreadyProcessed: true,
        transactionId: existingTransaction.rows[0].id,
      };
    }

    if (order.status === "successful") {
      await client.query("ROLLBACK");
      return { success: false, error: "Order is already successful" };
    }

    let walletResult = await client.query(
      `SELECT id, balance_minor FROM wallets WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );

    if (walletResult.rows.length === 0) {
      walletResult = await client.query(
        `INSERT INTO wallets (user_id, balance_minor, currency)
         VALUES ($1, 0, $2)
         RETURNING id, balance_minor`,
        [userId, order.currency],
      );
    }

    const wallet = walletResult.rows[0];
    const transactionResult = await client.query(
      `INSERT INTO wallet_transactions (
        user_id, wallet_id, type, direction, amount_minor, currency,
        status, provider, provider_reference, zapupi_order_id,
        reference, balance_before_minor, balance_after_minor, metadata
      ) VALUES (
        $1, $2, 'topup', 'credit', $3, $4,
        'failed', 'zapupi', $5, $6,
        $7, $8, $8, $9
      ) RETURNING id`,
      [
        userId,
        wallet.id,
        order.amount_minor,
        order.currency,
        `failed:${zapupiOrderId}`,
        zapupiOrderId,
        generateTransactionReference(),
        wallet.balance_minor,
        JSON.stringify({
          source: "zapupi",
          reason: reason || "Payment failed",
        }),
      ],
    );

    await client.query(
      `UPDATE wallet_topup_orders
          SET status = 'failed', provider_status = $1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
      [providerStatus || "failed", order.id],
    );

    await client.query("COMMIT");
    await syncFirebaseTopup({
      firebaseUid: order.firebase_uid,
      amount: order.amount_minor / 100,
      status: "FAILED",
      balanceAfter: wallet.balance_minor / 100,
      transactionId: transactionResult.rows[0].id,
      description: reason || "Payment failed",
    });
    return { success: true, transactionId: transactionResult.rows[0].id };
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error("RECORD_FAILED_TOPUP_ERROR", {
      userId,
      zapupiOrderId,
      error: error.message,
    });
    return {
      success: false,
      error: error.message || "Failed to record payment",
    };
  } finally {
    client.release();
  }
};

module.exports = { processTopup, recordFailedTopup };
