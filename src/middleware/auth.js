// backend/src/middleware/auth.js

const jwt = require("jsonwebtoken");
const { pool } = require("../config/database");
const { logger } = require("../utils/logger");

const JWT_SECRET = process.env.JWT_SECRET || "battlenexus-admin-secret";

// ============================================================
// FIREBASE ADMIN — lazy load
// ============================================================

let admin = null;
let firebaseAdminLoaded = false;

try {
  const firebaseAdminConfig = require("../config/firebase-admin");

  if (firebaseAdminConfig && firebaseAdminConfig.admin) {
    admin = firebaseAdminConfig.admin;
    firebaseAdminLoaded = true;
    console.log("✅ Firebase Admin loaded from config");
    console.log("📦 admin.auth type:", typeof admin.auth);
  } else {
    console.warn("⚠️ Firebase Admin config did not export `admin`");
  }
} catch (error) {
  console.warn("⚠️ Firebase Admin load error:", error.message);
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Try to verify a token as an admin JWT.
 * Returns the admin_users row, or null if the token isn't a valid
 * admin JWT.
 */
const tryVerifyAdminJwt = async (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const result = await pool.query(
      `SELECT id, full_name, email, role
       FROM admin_users
       WHERE id = $1
       LIMIT 1`,
      [decoded.sub],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    return null;
  }
};

/**
 * Verify a Firebase ID token with firebase-admin.
 * Returns the decoded token, or throws.
 */
const verifyFirebaseToken = async (token) => {
  if (!firebaseAdminLoaded || !admin) {
    throw new Error("Firebase Admin not loaded");
  }

  // Preferred: admin.auth().verifyIdToken(token)
  if (typeof admin.auth === "function") {
    return await admin.auth().verifyIdToken(token);
  }

  // Fallback: firebase-admin/auth getAuth()
  try {
    const { getAuth } = require("firebase-admin/auth");
    const authInstance = getAuth();
    return await authInstance.verifyIdToken(token);
  } catch (error) {
    throw new Error(`Firebase verification failed: ${error.message}`);
  }
};

/**
 * Find or create the Postgres `users` row for a Firebase UID.
 * Also ensures a wallet row exists.
 */
const findOrCreateFirebaseUser = async (decodedToken) => {
  const firebaseUid = decodedToken.uid;

  let result = await pool.query(
    `SELECT id, firebase_uid, email, display_name
     FROM users
     WHERE firebase_uid = $1
     LIMIT 1`,
    [firebaseUid],
  );

  let user = result.rows[0];

  if (user) {
    return user;
  }

  // Create user
  const insertResult = await pool.query(
    `INSERT INTO users (firebase_uid, email, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, firebase_uid, email, display_name`,
    [firebaseUid, decodedToken.email || null, decodedToken.name || null],
  );

  user = insertResult.rows[0];

  // Create wallet (ignore if it already exists)
  try {
    await pool.query(
      `INSERT INTO wallets (user_id, balance_minor, currency)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id, 0, "INR"],
    );
  } catch (error) {
    logger.warn("AUTH_WALLET_CREATE_WARN", {
      userId: user.id,
      message: error.message,
    });
  }

  logger.info("AUTH_USER_AUTO_CREATED", {
    userId: user.id,
    firebaseUid,
  });

  return user;
};

// ============================================================
// AUTHENTICATE
// ============================================================

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn("AUTH_MISSING_HEADER", { path: req.path });
      return res.status(401).json({
        success: false,
        error: "Authorization header required",
      });
    }

    const token = authHeader.slice("Bearer ".length).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Missing bearer token",
      });
    }

    // --------------------------------------------------------
    // 1. Try admin JWT first (admin panel login)
    // --------------------------------------------------------

    const adminUser = await tryVerifyAdminJwt(token);

    if (adminUser) {
      req.user = {
        id: adminUser.id,
        email: adminUser.email,
        full_name: adminUser.full_name,
        role: adminUser.role,
        type: "admin",
      };
      return next();
    }

    // --------------------------------------------------------
    // 2. Fall back to Firebase ID token (mobile / web app)
    // --------------------------------------------------------

    if (!firebaseAdminLoaded || !admin) {
      console.error("❌ Firebase Admin not loaded");
      return res.status(500).json({
        success: false,
        error: "Authentication service unavailable",
      });
    }

    let decodedToken;

    try {
      decodedToken = await verifyFirebaseToken(token);
    } catch (fbError) {
      console.error("❌ Firebase verification failed:", fbError.message);
      return res.status(401).json({
        success: false,
        error: "Invalid or expired token",
      });
    }

    // --------------------------------------------------------
    // 3. Find or create the Postgres user
    // --------------------------------------------------------

    let user;
    try {
      user = await findOrCreateFirebaseUser(decodedToken);
    } catch (dbError) {
      logger.error("AUTH_DB_ERROR", {
        message: dbError.message,
        code: dbError.code,
        detail: dbError.detail,
      });
      return res.status(500).json({
        success: false,
        error: "Failed to resolve user",
      });
    }

    // --------------------------------------------------------
    // 4. Attach user (with Postgres id) to request
    // --------------------------------------------------------

    req.user = {
      id: user.id,
      firebase_uid: user.firebase_uid,
      email: user.email,
      display_name: user.display_name,
      type: "firebase",
      decoded: decodedToken,
    };

    return next();
  } catch (error) {
    console.error("❌ AUTH_ERROR:", error);
    logger.error("AUTH_ERROR", {
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      error: "Authentication failed",
    });
  }
};

const requireAdminRole =
  (allowedRoles = []) =>
  (req, res, next) => {
    if (req.user?.type !== "admin") {
      return res.status(403).json({
        success: false,
        error: "Administrator access required",
      });
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: "Insufficient permissions",
      });
    }

    return next();
  };

module.exports = { authenticate, requireAdminRole };
