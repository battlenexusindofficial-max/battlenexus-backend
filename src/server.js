// backend/src/server.js

require("dotenv").config();

const { validateProductionConfig } = require("./config/production");
validateProductionConfig();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const { pool } = require("./config/database");
const { errorHandler } = require("./middleware/errorHandler");
const { runMigrations } = require("./migrations/run");

// ============================================================
// FIREBASE ADMIN
// ============================================================

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

// ============================================================
// ROUTES
// ============================================================
const tournamentRoutes = require("./routes/tournament.routes");
const walletRoutes = require("./routes/wallet.routes");
const webhookRoutes = require("./routes/webhook.routes");
const userRoutes = require("./routes/user.routes");
const apiV1Routes = require("./routes/api-v1");
const authRoutes = require("./routes/auth.routes");

// ============================================================
// APP
// ============================================================

const app = express();
const PORT = process.env.PORT || 5000;
const PUBLIC_BACKEND_URL =
  process.env.BACKEND_URL || `http://localhost:${PORT}`;
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

// ============================================================
// TRUST PROXY
// ============================================================

app.set("trust proxy", 1);

// ============================================================
// DATABASE MIGRATIONS
// ============================================================

const startupPromise = runMigrations().catch((error) => {
  console.error("❌ Startup migration failed:", error);
  throw error;
});

app.use(async (req, res, next) => {
  try {
    await startupPromise;
    next();
  } catch (error) {
    next(error);
  }
});

// ============================================================
// SECURITY
// ============================================================

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

// ============================================================
// CORS
//
// NOTE:
// Do NOT add `app.options("*", cors())` here.
// Express 5 uses path-to-regexp v8, which does not allow the
// bare "*" wildcard and crashes the server with:
//   PathError: Missing parameter name at index 1: *
//
// The cors() middleware below already answers preflight
// OPTIONS requests automatically, so no extra handler is needed.
// ============================================================

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(origin)) {
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

// ============================================================
// LOGGER
// ============================================================

app.use(morgan("combined"));

// ============================================================
// REQUEST DEBUG
// ============================================================

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

// ============================================================
// BODY PARSER (custom, charset-agnostic)
//
// We AVOID express.json() because body-parser rejects
// `charset=UTF-8` (uppercase) on some versions with:
//
//   415 {"error":"unsupported charset \"UTF-8\""}
//
// This parser ignores the charset entirely, decodes the body
// as UTF-8 (which is what JSON requires), and JSON.parse()s it.
// It cannot throw a charset error because it never inspects
// the charset.
//
// DO NOT add express.json() anywhere in this file.
// ============================================================

app.use((req, res, next) => {
  // Requests without a body
  if (
    req.method === "GET" ||
    req.method === "HEAD" ||
    req.method === "OPTIONS"
  ) {
    return next();
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();

  // Only parse JSON-ish bodies
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

    // 10 MB limit
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

    // Empty body
    if (!body.trim()) {
      req.body = {};
      return next();
    }

    try {
      req.body = JSON.parse(body);
      next();
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: "Invalid JSON body",
        detail: err.message,
      });
    }
  });

  req.on("error", (err) => {
    if (done) return;
    done = true;

    return res.status(400).json({
      success: false,
      error: "Failed to read request body",
      detail: err.message,
    });
  });
});

// Also accept urlencoded bodies (form posts from older clients)
// NOTE: This is the ONLY urlencoded parser. Do not duplicate it.
app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  }),
);

// ============================================================
// API ROUTES
// ============================================================
app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/user", userRoutes);
app.use("/api/tournaments", tournamentRoutes);
app.use("/api/v1", apiV1Routes);

app.get("/api", (req, res) => {
  return res.status(200).json({
    success: true,
    service: "battlenexus-api",
    version: "v1",
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// HEALTH CHECK
// ============================================================

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

app.get("/health", async (req, res) => {
  return res.redirect(307, "/api/health");
});

// ============================================================
// 404
// ============================================================

app.use((req, res) => {
  console.log(`❌ 404 ROUTE NOT FOUND: ${req.method} ${req.originalUrl}`);

  return res.status(404).json({
    success: false,
    error: "Route not found",
    path: req.originalUrl,
    method: req.method,
  });
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use(errorHandler);

// ============================================================
// START SERVER
// ============================================================

let server;

const startServer = async () => {
  try {
    await startupPromise;

    server = app.listen(PORT, "0.0.0.0", () => {
      console.log("\n========================================");
      console.log("🚀 BATTLE NEXUS BACKEND");
      console.log("========================================");
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(
        `💰 ZapUPI mode: ${process.env.ZAPUPI_MODE || "not configured"}`,
      );
      console.log(
        `🔑 ZapUPI key: ${
          process.env.ZAPUPI_ZAP_KEY ? "✅ Loaded" : "❌ Missing"
        }`,
      );
      console.log(
        `🌐 ZapUPI API: ${process.env.ZAPUPI_API_BASE || "not configured"}`,
      );
      console.log(
        `🔥 Firebase Admin: ${
          firebaseAdminLoaded ? "✅ Available" : "❌ Not available"
        }`,
      );
      console.log("🗄️ PostgreSQL: ✅ Ready");
      console.log(`🔗 API URL: ${PUBLIC_BACKEND_URL}/api`);
      console.log(`🔗 Health: ${PUBLIC_BACKEND_URL}/health`);
      console.log("========================================\n");
    });

    // ========================================================
    // GRACEFUL SHUTDOWN
    // ========================================================

    const shutdown = async (signal) => {
      console.log(`\n🔄 Received ${signal}`);
      console.log("🔄 Shutting down gracefully...");

      if (server) {
        server.close(async () => {
          try {
            await pool.end();

            console.log("✅ PostgreSQL connection closed");

            process.exit(0);
          } catch (error) {
            console.error("❌ Error closing PostgreSQL:", error);

            process.exit(1);
          }
        });
      } else {
        try {
          await pool.end();

          console.log("✅ PostgreSQL connection closed");

          process.exit(0);
        } catch (error) {
          console.error("❌ Error closing PostgreSQL:", error);

          process.exit(1);
        }
      }
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    console.error("❌ Failed to start server:", error);

    process.exit(1);
  }
};

// ============================================================
// START
// ============================================================

if (require.main === module) {
  startServer();
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  app,
  server,
  startupPromise,
};
