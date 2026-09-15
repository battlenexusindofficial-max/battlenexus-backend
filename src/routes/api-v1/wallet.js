const express = require("express");
const router = express.Router();
const { authenticate } = require("../../middleware/auth");

router.get("/balance", authenticate, (req, res) => {
  res.status(200).json({
    success: true,
    message: "Wallet balance endpoint is available.",
    data: {
      userId: req.user?.id || null,
      firebaseUid: req.user?.firebase_uid || null,
      balance: 0,
      currency: "INR",
    },
  });
});

router.get("/transactions", authenticate, (req, res) => {
  res.status(200).json({
    success: true,
    message: "Transaction history endpoint is available.",
    data: {
      userId: req.user?.id || null,
      transactions: [],
    },
  });
});

module.exports = router;
