const { logger } = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
  logger.error("SERVER_ERROR", {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack,
  });

  // Don't leak internal details in production
  const isProduction = process.env.NODE_ENV === "production";

  res.status(err.status || 500).json({
    success: false,
    error: isProduction
      ? "Internal server error"
      : err.message || "Internal server error",
    ...(isProduction ? {} : { stack: err.stack }),
  });
};

module.exports = { errorHandler };
