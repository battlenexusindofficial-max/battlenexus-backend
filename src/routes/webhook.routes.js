// battlenexus-backend/src/routes/webhook.routes.js

const express = require("express");
const router = express.Router();
const { handleZapUPIWebhook } = require("../controllers/webhook.controller");
const { webhookRateLimiter } = require("../middleware/rateLimiter");

const validateWebhookContentType = (req, res, next) => {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (
    !contentType.startsWith("application/json") &&
    !contentType.startsWith("application/x-www-form-urlencoded")
  ) {
    return res.status(415).json({ status: "error" });
  }
  return next();
};

router.post(
  "/zapupi",
  webhookRateLimiter(60000, 50),
  validateWebhookContentType,
  handleZapUPIWebhook,
);

module.exports = router;
