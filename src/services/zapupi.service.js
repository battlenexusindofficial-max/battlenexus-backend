// battlenexus-backend/src/services/zapupi.service.js

const axios = require("axios");
const https = require("https");

// Force IPv4 to avoid IPv6 whitelist issues
const ipv4Agent = new https.Agent({ family: 4 });

// ============================================================
// CONFIGURATION
// ============================================================

const ZAPUPI_API_BASE =
  process.env.ZAPUPI_BASE_URL ||
  process.env.ZAPUPI_API_BASE ||
  "https://pay.zapupi.com/api";
const ZAPUPI_ZAP_KEY = process.env.ZAPUPI_API_KEY || process.env.ZAPUPI_ZAP_KEY;
const ZAPUPI_ENVIRONMENT =
  process.env.ZAPUPI_ENVIRONMENT || process.env.ZAPUPI_MODE;
const ZAPUPI_TIMEOUT_MS = Number(process.env.ZAPUPI_TIMEOUT_MS || 8000);

const isExpectedEnvironment = (providerEnvironment) => {
  const expected = (ZAPUPI_ENVIRONMENT || "").toLowerCase();
  const received = String(providerEnvironment || "").toLowerCase();
  if (!expected) return true;
  if (expected === "live") return ["live", "cashier"].includes(received);
  return received === expected;
};

if (!ZAPUPI_ZAP_KEY) {
  console.error("ZapUPI API key is not set");
}

// ============================================================
// CONSTANTS
// ============================================================

const MIN_TOPUP_AMOUNT = 10;
const MAX_TOPUP_AMOUNT = 5000;
const ALLOWED_TOPUP_AMOUNTS = [10, 20, 50, 100, 200, 500, 1000, 5000];

// ============================================================
// VALIDATION
// ============================================================

const validateTopupAmount = (amount) => {
  if (typeof amount !== "number" || isNaN(amount)) {
    return { valid: false, error: "Amount must be a valid number" };
  }
  if (!Number.isInteger(amount)) {
    return { valid: false, error: "Amount must be a whole number (integer)" };
  }
  if (amount < MIN_TOPUP_AMOUNT) {
    return {
      valid: false,
      error: `Minimum topup amount is ₹${MIN_TOPUP_AMOUNT}`,
    };
  }
  if (amount > MAX_TOPUP_AMOUNT) {
    return {
      valid: false,
      error: `Maximum topup amount is ₹${MAX_TOPUP_AMOUNT}`,
    };
  }
  return { valid: true };
};

// ============================================================
// CREATE ORDER
// ============================================================

const createOrder = async (
  amountInMinor,
  currency,
  reference,
  options = {},
) => {
  try {
    const amountRupees = (amountInMinor / 100).toFixed(2);

    const payload = {
      zap_key: ZAPUPI_ZAP_KEY,
      order_id: reference,
      amount: amountRupees,
      customer_mobile: options.mobile || undefined,
      remark: options.remark || undefined,
      webhook_url: options.webhookUrl || undefined,
      success_url: options.successUrl || undefined,
      failed_url: options.failedUrl || undefined,
      timeout_url: options.timeoutUrl || undefined,
    };

    Object.keys(payload).forEach(
      (k) => payload[k] === undefined && delete payload[k],
    );

    const response = await axios.post(
      `${ZAPUPI_API_BASE}/create-order`,
      payload,
      {
        headers: { "Content-Type": "application/json" },
        timeout: ZAPUPI_TIMEOUT_MS,
        httpsAgent: ipv4Agent,
      },
    );

    const data = response.data;

    if (data && data.status === "success") {
      const responseData = data.data || data;
      const zapupiOrderId =
        data.order_id ||
        data.orderId ||
        responseData.order_id ||
        responseData.orderId ||
        reference;

      const paymentUrl =
        data.payment_url ||
        data.paymentUrl ||
        responseData.payment_url ||
        responseData.paymentUrl ||
        null;

      if (!paymentUrl) {
        return { success: false, error: "No payment URL in response" };
      }

      return {
        success: true,
        order: {
          id: zapupiOrderId,
          reference: reference,
          amount: amountInMinor,
          currency: currency || "INR",
          payment_url: paymentUrl,
          txn_id: data.txn_id || null,
        },
      };
    }

    return {
      success: false,
      error: data?.message || "Failed to create order",
    };
  } catch (error) {
    console.error("❌ ZapUPI create error:", error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
};

// ============================================================
// ORDER STATUS
// ============================================================

const getOrderStatus = async (orderId) => {
  try {
    const response = await axios.post(
      `${ZAPUPI_API_BASE}/order-status`,
      {
        zap_key: ZAPUPI_ZAP_KEY,
        order_id: orderId,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: ZAPUPI_TIMEOUT_MS,
        httpsAgent: ipv4Agent,
      },
    );

    const data = response.data;

    if (data && data.status === "success" && data.data) {
      return {
        success: true,
        payment: {
          status: String(data.data.status || "").trim(),
          order_id: String(data.data.order_id || "").trim(),
          txn_id: String(data.data.txn_id || "").trim(),
          amount: String(data.data.amount || "").trim(),
          pay_amount: String(data.data.pay_amount || "").trim(),
          utr: String(data.data.utr || "").trim(),
          environment: String(data.data.environment || "").trim(),
        },
      };
    }

    return {
      success: false,
      error: data?.message || "Failed to fetch order status",
    };
  } catch (error) {
    console.error("❌ ZapUPI status error:", error.message);
    return {
      success: false,
      error: error.message || "Failed to fetch order status",
    };
  }
};

// ============================================================
// WEBHOOK NORMALIZATION
// ============================================================

const normalizeWebhook = (body) => ({
  order_id: String(body?.order_id || "").trim(),
  txn_id: String(body?.txn_id || "").trim(),
  status: String(body?.status || "").trim(),
  amount: String(body?.amount || "").trim(),
  pay_amount: String(body?.pay_amount || "").trim(),
  utr: String(body?.utr || "").trim(),
  customer_mobile: String(body?.customer_mobile || ""),
  remark: String(body?.remark || ""),
  environment: String(body?.environment || "").trim(),
  create_at: String(body?.create_at || "").trim(),
});

const isTestWebhook = (payload) =>
  payload.environment === "test" || payload.txn_id.startsWith("DUMMY");

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  MIN_TOPUP_AMOUNT,
  MAX_TOPUP_AMOUNT,
  ALLOWED_TOPUP_AMOUNTS,
  validateTopupAmount,
  createOrder,
  getOrderStatus,
  normalizeWebhook,
  isTestWebhook,
  isExpectedEnvironment,
  ZAPUPI_ENVIRONMENT,
};
