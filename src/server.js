// backend/src/server.js

require("dotenv").config();

// =========================================================
// PRODUCTION CONFIGURATION
// =========================================================

const { validateProductionConfig } = require("./config/production");

validateProductionConfig();

// =========================================================
// DEPENDENCIES
// =========================================================

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

// =========================================================
// DATABASE / MIDDLEWARE
// =========================================================

const { pool } = require("./config/database");
const { errorHandler } = require("./middleware/errorHandler");
const { runMigrations } = require("./migrations/run");

// =========================================================
// FIREBASE ADMIN
// =========================================================

let firebaseAdminLoaded = false;
let admin = null;

try {
  console.log("🔄 Loading Firebase Admin...");

  const firebaseAdmin = require("./config/firebase-admin");

  if (firebaseAdmin && firebaseAdmin.admin && firebaseAdmin.firebaseApp) {
    admin = firebaseAdmin.admin;
    firebaseAdminLoaded = true;

    console.log("✅ Firebase Admin loaded successfully");
    console.log(`📦 admin.auth type: ${typeof admin.auth}`);
  } else {
    console.warn(
      "⚠️ Firebase Admin initialization failed - continuing without it",
    );
  }
} catch (error) {
  console.warn("⚠️ Firebase Admin not available:", error.message);
}

// =========================================================
// ROUTES
// =========================================================

const tournamentRoutes = require("./routes/tournament.routes");
const walletRoutes = require("./routes/wallet.routes");
const webhookRoutes = require("./routes/webhook.routes");
const userRoutes = require("./routes/user.routes");
const apiV1Routes = require("./routes/api-v1");
const authRoutes = require("./routes/auth.routes");

// =========================================================
// EXPRESS APP
// =========================================================

const app = express();

const PORT = Number(process.env.PORT || 5000);

const PUBLIC_BACKEND_URL =
  process.env.BACKEND_URL || `http://localhost:${PORT}`;

// =========================================================
// CORS
// =========================================================

const configuredCorsOrigins = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOrigins =
  configuredCorsOrigins.length > 0
    ? configuredCorsOrigins
    : process.env.NODE_ENV === "production"
      ? []
      : ["http://localhost:3000", "http://localhost:8081"];

app.set("trust proxy", 1);

// =========================================================
// DATABASE MIGRATIONS
// =========================================================

const startupPromise = runMigrations().catch((error) => {
  console.error("❌ Startup migration failed:", error);

  throw error;
});

// Make sure migrations finish before processing requests.
app.use(async (req, res, next) => {
  try {
    await startupPromise;
    next();
  } catch (error) {
    next(error);
  }
});

// =========================================================
// SECURITY
// =========================================================

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

// =========================================================
// CORS MIDDLEWARE
// =========================================================

app.use(
  cors({
    origin: (origin, callback) => {
      // Server-to-server/webhook requests may not
      // contain an Origin header.
      if (!origin) {
        return callback(null, true);
      }

      if (corsOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin is not allowed by CORS"));
    },

    credentials: true,

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "X-Zapupi-Signature",
    ],
  }),
);

// =========================================================
// HTTP LOGGER
// =========================================================

app.use(morgan("combined"));

// =========================================================
// REQUEST DEBUG LOGGER
// =========================================================

app.use((req, res, next) => {
  console.log("\n========================================");
  console.log("📥 REQUEST");
  console.log("========================================");

  console.log("METHOD:", req.method);
  console.log("URL:", req.originalUrl);

  console.log("CONTENT-TYPE:", JSON.stringify(req.headers["content-type"]));

  console.log(
    "CONTENT-ENCODING:",
    JSON.stringify(req.headers["content-encoding"]),
  );

  console.log("CONTENT-LENGTH:", JSON.stringify(req.headers["content-length"]));

  console.log(
    "AUTHORIZATION:",
    req.headers.authorization
      ? "Bearer token present"
      : "No authorization header",
  );

  console.log("========================================\n");

  next();
});

// =========================================================
// JSON BODY PARSER
// =========================================================
//
// Custom parser retained from your existing server.
// Maximum JSON body size: 10 MB.
//

app.use((req, res, next) => {
  if (
    req.method === "GET" ||
    req.method === "HEAD" ||
    req.method === "OPTIONS"
  ) {
    return next();
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();

  if (
    !contentType.startsWith("application/json") &&
    !contentType.includes("+json")
  ) {
    return next();
  }

  let body = "";
  let done = false;

  req.setEncoding("utf8");

  req.on("data", (chunk) => {
    if (done) return;

    body += chunk;

    if (Buffer.byteLength(body, "utf8") > 10 * 1024 * 1024) {
      done = true;

      return res.status(413).json({
        success: false,
        error: "Request body too large",
      });
    }
  });

  req.on("end", () => {
    if (done) return;

    done = true;

    if (!body.trim()) {
      req.body = {};
      return next();
    }

    try {
      req.body = JSON.parse(body);
      next();
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: "Invalid JSON body",
        detail: error.message,
      });
    }
  });

  req.on("error", (error) => {
    if (done) return;

    done = true;

    return res.status(400).json({
      success: false,
      error: "Failed to read request body",
      detail: error.message,
    });
  });
});

// =========================================================
// URL-ENCODED BODY PARSER
// =========================================================

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  }),
);

// =========================================================
// API ROUTES
// =========================================================

app.use("/api/auth", authRoutes);

app.use("/api/wallet", walletRoutes);

app.use("/api/webhooks", webhookRoutes);

app.use("/api/user", userRoutes);

app.use("/api/tournaments", tournamentRoutes);

app.use("/api/v1", apiV1Routes);

// =========================================================
// API ROOT
// =========================================================

app.get("/api", (req, res) => {
  return res.status(200).json({
    success: true,
    service: "battlenexus-api",
    version: "v1",
    timestamp: new Date().toISOString(),
  });
});

// =========================================================
// HEALTH CHECK
// =========================================================

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    return res.status(200).json({
      success: true,
      status: "healthy",

      environment: process.env.NODE_ENV || "development",

      timestamp: new Date().toISOString(),

      firebaseAdmin: firebaseAdminLoaded,

      database: "connected",

      zapupi: {
        mode: process.env.ZAPUPI_MODE || "not configured",

        apiKey: process.env.ZAPUPI_API_KEY ? "configured" : "missing",

        apiBase: process.env.ZAPUPI_API_BASE || "https://pay.zapupi.com/api",
      },
    });
  } catch (error) {
    console.error("❌ Health check database error:", error);

    return res.status(503).json({
      success: false,
      status: "unhealthy",
      error: "Database connection failed",
      database: "disconnected",
    });
  }
});

// =========================================================
// SHORT HEALTH ROUTE
// =========================================================

app.get("/health", async (req, res) => {
  return res.redirect(307, "/api/health");
});

// =========================================================
// 404 HANDLER
// =========================================================

app.use((req, res) => {
  console.log(`❌ 404 ROUTE NOT FOUND: ${req.method} ${req.originalUrl}`);

  return res.status(404).json({
    success: false,
    error: "Route not found",
    path: req.originalUrl,
    method: req.method,
  });
});

// =========================================================
// GLOBAL ERROR HANDLER
// =========================================================

app.use(errorHandler);

// =========================================================
// START SERVER
// =========================================================

let server = null;

const startServer = async () => {
  try {
    // Wait for database migrations.
    await startupPromise;

    server = app.listen(PORT, "0.0.0.0", () => {
      console.log("\n========================================");

      console.log("🚀 BATTLE NEXUS BACKEND");

      console.log("========================================");

      console.log(`🚀 Server running on port ${PORT}`);

      console.log(`📍 Environment: ${process.env.NODE_ENV || "development"}`);

      // =================================================
      // ZAPUPI
      // =================================================

      console.log(
        `💰 ZapUPI mode: ${process.env.ZAPUPI_MODE || "not configured"}`,
      );

      // IMPORTANT:
      // Current variable is ZAPUPI_API_KEY.
      // Do NOT use the old ZAPUPI_ZAP_KEY here.
      console.log(
        `🔑 ZapUPI key: ${
          process.env.ZAPUPI_API_KEY ? "✅ Loaded" : "❌ Missing"
        }`,
      );

      console.log(
        `🌐 ZapUPI API: ${
          process.env.ZAPUPI_API_BASE || "https://pay.zapupi.com/api"
        }`,
      );

      // =================================================
      // FIREBASE
      // =================================================

      console.log(
        `🔥 Firebase Admin: ${
          firebaseAdminLoaded ? "✅ Available" : "❌ Not available"
        }`,
      );

      // =================================================
      // DATABASE
      // =================================================

      console.log("🗄️ PostgreSQL: ✅ Ready");

      // =================================================
      // PUBLIC API
      // =================================================

      console.log(`🔗 API URL: ${PUBLIC_BACKEND_URL}/api`);

      console.log(`🔗 Health: ${PUBLIC_BACKEND_URL}/health`);

      console.log("========================================\n");
    });

    // =====================================================
    // HTTP SERVER ERROR
    // =====================================================

    server.on("error", (error) => {
      console.error("❌ HTTP server error:", error);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);

    process.exit(1);
  }
};

// =========================================================
// GRACEFUL SHUTDOWN
// =========================================================

const gracefulShutdown = async (signal) => {
  console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);

  try {
    if (server) {
      await new Promise((resolve) => {
        server.close(() => {
          console.log("✅ HTTP server closed");

          resolve();
        });
      });
    }

    await pool.end();

    console.log("✅ PostgreSQL connection pool closed");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error during graceful shutdown:", error);

    process.exit(1);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// =========================================================
// START APPLICATION
// =========================================================

if (require.main === module) {
  startServer();
}

// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  app,
  server,
  startupPromise,
};
