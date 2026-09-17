// battlenexus-backend/src/routes/wallet.routes.js

const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { rateLimiter } = require("../middleware/rateLimiter");
const {
  createTopupOrder,
  verifyTopup,
  checkPaymentStatus,
  reconcilePendingTopups,
  getWalletBalance,
  getTransactions,
  getTopupConfig,
} = require("../controllers/wallet.controller");

router.use(authenticate);

router.get("/topup/config", getTopupConfig);

router.post("/topup/order", rateLimiter(60000, 5), createTopupOrder);

router.post("/topup/verify", rateLimiter(60000, 10), verifyTopup);

router.get("/topup/status/:orderId", checkPaymentStatus);

router.post("/topup/reconcile", rateLimiter(60000, 10), reconcilePendingTopups);

router.get("/balance", getWalletBalance);

router.get("/transactions", getTransactions);

module.exports = router;
