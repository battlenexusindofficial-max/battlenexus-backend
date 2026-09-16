// battlenexus-backend/src/services/zapupi.service.js

const axios = require("axios");
const https = require("https");

// ============================================================
// ZAPUPI CONFIGURATION
// ============================================================

// Force IPv4 to avoid IPv6 / whitelist issues.
const ipv4Agent = new https.Agent({
  family: 4,
  keepAlive: true,
});

// ------------------------------------------------------------
// Environment variables
// ------------------------------------------------------------

const ZAPUPI_API_BASE =
  process.env.ZAPUPI_API_BASE || "https://pay.zapupi.com/api";

const ZAPUPI_API_KEY = process.env.ZAPUPI_API_KEY || "";

const ZAPUPI_MODE = process.env.ZAPUPI_MODE || "production";

const ZAPUPI_TIMEOUT_MS = Number(process.env.ZAPUPI_TIMEOUT_MS) || 8000;

// Remove accidental trailing slash.
const NORMALIZED_ZAPUPI_API_BASE = ZAPUPI_API_BASE.replace(/\/+$/, "");

// ============================================================
// CONFIGURATION STATUS
// ============================================================

const isZapupiConfigured = () => {
  return Boolean(ZAPUPI_API_KEY && NORMALIZED_ZAPUPI_API_BASE);
};

const getZapupiConfigStatus = () => {
  return {
    configured: isZapupiConfigured(),

    mode: ZAPUPI_MODE,

    apiBase: NORMALIZED_ZAPUPI_API_BASE,

    hasApiKey: Boolean(ZAPUPI_API_KEY),

    timeoutMs: ZAPUPI_TIMEOUT_MS,
  };
};

// ============================================================
// STARTUP LOG
// ============================================================

if (ZAPUPI_API_KEY) {
  console.log("ZapUPI key: ✅ Configured");
} else {
  console.error("ZapUPI key: ❌ Missing");
}

if (NORMALIZED_ZAPUPI_API_BASE) {
  console.log(`🌐 ZapUPI API: ${NORMALIZED_ZAPUPI_API_BASE}`);
} else {
  console.error("🌐 ZapUPI API: ❌ Not configured");
}

console.log(`💳 ZapUPI mode: ${ZAPUPI_MODE}`);

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
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return {
      valid: false,
      error: "Amount must be a valid number",
    };
  }

  if (!Number.isInteger(amount)) {
    return {
      valid: false,
      error: "Amount must be a whole number (integer)",
    };
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

  return {
    valid: true,
  };
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
    // --------------------------------------------------------
    // Configuration check
    // --------------------------------------------------------

    if (!ZAPUPI_API_KEY) {
      return {
        success: false,
        error: "ZapUPI API key is not configured",
      };
    }

    if (!NORMALIZED_ZAPUPI_API_BASE) {
      return {
        success: false,
        error: "ZapUPI API base URL is not configured",
      };
    }

    // --------------------------------------------------------
    // Validate amount
    // --------------------------------------------------------

    if (typeof amountInMinor !== "number" || !Number.isFinite(amountInMinor)) {
      return {
        success: false,
        error: "Invalid payment amount",
      };
    }

    if (amountInMinor <= 0) {
      return {
        success: false,
        error: "Payment amount must be greater than zero",
      };
    }

    if (!reference) {
      return {
        success: false,
        error: "Payment reference is required",
      };
    }

    // --------------------------------------------------------
    // Convert minor units to INR
    //
    // Example:
    // 10000 -> ₹100.00
    // --------------------------------------------------------

    const amountRupees = (amountInMinor / 100).toFixed(2);

    // --------------------------------------------------------
    // ZapUPI create-order payload
    // --------------------------------------------------------

    const payload = {
      zap_key: ZAPUPI_API_KEY,

      order_id: String(reference),

      amount: amountRupees,

      customer_mobile: options.mobile || undefined,

      remark: options.remark || undefined,

      webhook_url: options.webhookUrl || undefined,

      success_url: options.successUrl || undefined,

      failed_url: options.failedUrl || undefined,

      timeout_url: options.timeoutUrl || undefined,
    };

    // Remove undefined properties.
    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    });

    // --------------------------------------------------------
    // Endpoint
    // --------------------------------------------------------

    const endpoint = `${NORMALIZED_ZAPUPI_API_BASE}/create-order`;

    console.log(`💳 Creating ZapUPI order: ${reference}`);

    console.log(`💰 Amount: ₹${amountRupees}`);

    console.log(`🌐 Endpoint: ${endpoint}`);

    // --------------------------------------------------------
    // Request
    // --------------------------------------------------------

    const response = await axios.post(endpoint, payload, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },

      timeout: ZAPUPI_TIMEOUT_MS,

      httpsAgent: ipv4Agent,

      validateStatus: () => true,
    });

    const data = response.data;

    // --------------------------------------------------------
    // HTTP error
    // --------------------------------------------------------

    if (response.status < 200 || response.status >= 300) {
      console.error("❌ ZapUPI HTTP error:", response.status, data);

      return {
        success: false,
        error: data?.message || `ZapUPI returned HTTP ${response.status}`,
      };
    }

    // --------------------------------------------------------
    // ZapUPI response
    // --------------------------------------------------------

    if (data && String(data.status).toLowerCase() === "success") {
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

      const transactionId =
        data.txn_id ||
        data.txnId ||
        responseData.txn_id ||
        responseData.txnId ||
        null;

      if (!paymentUrl) {
        console.error("❌ ZapUPI did not return payment URL", data);

        return {
          success: false,
          error: "ZapUPI did not return a payment URL",
        };
      }

      console.log(`✅ ZapUPI order created: ${zapupiOrderId}`);

      return {
        success: true,

        order: {
          id: String(zapupiOrderId),

          reference: String(reference),

          amount: amountInMinor,

          currency: currency || "INR",

          payment_url: paymentUrl,

          txn_id: transactionId,

          provider: "zapupi",
        },
      };
    }

    // --------------------------------------------------------
    // Provider returned failure
    // --------------------------------------------------------

    console.error("❌ ZapUPI order creation failed:", data);

    return {
      success: false,

      error: data?.message || data?.error || "Failed to create ZapUPI order",
    };
  } catch (error) {
    console.error("❌ ZapUPI create error:", error.message);

    if (error.response) {
      console.error("ZapUPI response:", error.response.data);
    }

    if (error.code) {
      console.error("ZapUPI error code:", error.code);
    }

    return {
      success: false,

      error:
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        "Failed to create ZapUPI order",
    };
  }
};

// ============================================================
// ORDER STATUS
// ============================================================

const getOrderStatus = async (orderId) => {
  try {
    // --------------------------------------------------------
    // Configuration check
    // --------------------------------------------------------

    if (!ZAPUPI_API_KEY) {
      return {
        success: false,
        error: "ZapUPI API key is not configured",
      };
    }

    if (!orderId) {
      return {
        success: false,
        error: "ZapUPI order ID is required",
      };
    }

    // --------------------------------------------------------
    // Endpoint
    // --------------------------------------------------------

    const endpoint = `${NORMALIZED_ZAPUPI_API_BASE}/order-status`;

    console.log(`🔎 Checking ZapUPI order: ${orderId}`);

    // --------------------------------------------------------
    // Request
    // --------------------------------------------------------

    const response = await axios.post(
      endpoint,

      {
        zap_key: ZAPUPI_API_KEY,

        order_id: String(orderId),
      },

      {
        headers: {
          "Content-Type": "application/json",

          Accept: "application/json",
        },

        timeout: ZAPUPI_TIMEOUT_MS,

        httpsAgent: ipv4Agent,

        validateStatus: () => true,
      },
    );

    const data = response.data;

    // --------------------------------------------------------
    // HTTP error
    // --------------------------------------------------------

    if (response.status < 200 || response.status >= 300) {
      console.error("❌ ZapUPI status HTTP error:", response.status, data);

      return {
        success: false,

        error: data?.message || `ZapUPI returned HTTP ${response.status}`,
      };
    }

    // --------------------------------------------------------
    // Successful response
    // --------------------------------------------------------

    if (data && String(data.status).toLowerCase() === "success") {
      const paymentData = data.data || data;

      return {
        success: true,

        payment: {
          status: String(paymentData.status || "").trim(),

          order_id: String(
            paymentData.order_id || paymentData.orderId || orderId || "",
          ).trim(),

          txn_id: String(paymentData.txn_id || paymentData.txnId || "").trim(),

          amount: String(paymentData.amount || "").trim(),

          pay_amount: String(
            paymentData.pay_amount || paymentData.payAmount || "",
          ).trim(),

          utr: String(paymentData.utr || "").trim(),

          environment: String(paymentData.environment || "").trim(),
        },
      };
    }

    return {
      success: false,

      error: data?.message || data?.error || "Failed to fetch order status",
    };
  } catch (error) {
    console.error("❌ ZapUPI status error:", error.message);

    if (error.response) {
      console.error("ZapUPI response:", error.response.data);
    }

    return {
      success: false,

      error:
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        "Failed to fetch order status",
    };
  }
};

// ============================================================
// WEBHOOK NORMALIZATION
// ============================================================

const normalizeWebhook = (body) => {
  return {
    order_id: String(body?.order_id || body?.orderId || "").trim(),

    txn_id: String(body?.txn_id || body?.txnId || "").trim(),

    status: String(body?.status || "").trim(),

    amount: String(body?.amount || "").trim(),

    pay_amount: String(body?.pay_amount || body?.payAmount || "").trim(),

    utr: String(body?.utr || "").trim(),

    customer_mobile: String(
      body?.customer_mobile || body?.customerMobile || "",
    ).trim(),

    remark: String(body?.remark || "").trim(),

    environment: String(body?.environment || "").trim(),

    create_at: String(
      body?.create_at || body?.created_at || body?.createdAt || "",
    ).trim(),
  };
};

// ============================================================
// TEST WEBHOOK DETECTION
// ============================================================

const isTestWebhook = (payload) => {
  const environment = String(payload?.environment || "")
    .trim()
    .toLowerCase();

  const txnId = String(payload?.txn_id || "").trim();

  return environment === "test" || txnId.startsWith("DUMMY");
};

// ============================================================
// ENVIRONMENT VALIDATION
// ============================================================

const isExpectedEnvironment = (providerEnvironment) => {
  const expected = String(ZAPUPI_MODE || "")
    .trim()
    .toLowerCase();

  const received = String(providerEnvironment || "")
    .trim()
    .toLowerCase();

  // If provider doesn't send environment,
  // don't reject solely because it is absent.
  if (!received) {
    return true;
  }

  if (expected === "production" || expected === "live") {
    return ["production", "live", "cashier"].includes(received);
  }

  if (expected === "test") {
    return received === "test";
  }

  return received === expected;
};

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

  isZapupiConfigured,

  getZapupiConfigStatus,

  ZAPUPI_API_BASE: NORMALIZED_ZAPUPI_API_BASE,

  ZAPUPI_ENVIRONMENT: ZAPUPI_MODE,
};
