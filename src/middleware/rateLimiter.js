/**
 * Simple in-memory rate limiter
 * For production, use Redis (ioredis or similar)
 */
const rateLimiter = (windowMs = 60000, maxRequests = 10) => {
  const requests = new Map();

  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!requests.has(key)) {
      requests.set(key, []);
    }

    const timestamps = requests.get(key);
    const windowStart = now - windowMs;

    // Remove old timestamps
    while (timestamps.length > 0 && timestamps[0] < windowStart) {
      timestamps.shift();
    }

    if (timestamps.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: "Too many requests, please try again later",
      });
    }

    timestamps.push(now);
    next();
  };
};

/**
 * Webhook rate limiter - more permissive
 */
const webhookRateLimiter = (windowMs = 60000, maxRequests = 50) => {
  return rateLimiter(windowMs, maxRequests);
};

module.exports = { rateLimiter, webhookRateLimiter };
