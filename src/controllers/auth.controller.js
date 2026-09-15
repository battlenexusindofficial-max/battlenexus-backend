// backend/src/controllers/auth.controller.js

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/database");
const { logger } = require("../utils/logger");

const JWT_SECRET = process.env.JWT_SECRET || "battlenexus-admin-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// ============================================================
// PASSWORD HASHING (PBKDF2)
// ============================================================

const createPasswordHash = (
  password,
  salt = crypto.randomBytes(16).toString("hex"),
) => {
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");

  return { salt, hash: `${salt}:${hash}` };
};

const verifyPassword = (password, storedHash) => {
  if (!storedHash || typeof storedHash !== "string") {
    return false;
  }

  const [salt, hash] = storedHash.split(":");

  if (!salt || !hash) {
    return false;
  }

  const candidate = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");

  return candidate === hash;
};

// ============================================================
// HELPERS
// ============================================================

const normalizePhoneNumber = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
};

const createToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      email: user.email,
      phone_number: user.phone_number || null,
      role: user.role || "admin",
      full_name: user.full_name,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );

const checkDuplicateAdminIdentity = async (email, phone_number) => {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  const normalizedPhone = normalizePhoneNumber(phone_number);

  if (normalizedEmail) {
    const emailCheck = await pool.query(
      "SELECT id, full_name, email, phone_number FROM admin_users WHERE LOWER(email) = LOWER($1)",
      [normalizedEmail],
    );

    if (emailCheck.rows.length > 0) {
      return {
        type: "email",
        message: "An admin account with this email already exists.",
        user: emailCheck.rows[0],
      };
    }
  }

  if (normalizedPhone) {
    const phoneCheck = await pool.query(
      "SELECT id, full_name, email, phone_number FROM admin_users WHERE phone_number = $1",
      [normalizedPhone],
    );

    if (phoneCheck.rows.length > 0) {
      return {
        type: "phone",
        message: "An admin account with this phone number already exists.",
        user: phoneCheck.rows[0],
      };
    }
  }

  return null;
};

// ============================================================
// POST /api/auth/signup  (email + password)
// ============================================================

const signupAdmin = async (req, res) => {
  try {
    const { full_name, email, password, phone_number } = req.body || {};

    if (!full_name || !email || !password) {
      return res.status(422).json({
        success: false,
        message: "full_name, email, and password are required.",
      });
    }

    const trimmedName = String(full_name).trim();
    const trimmedEmail = String(email).trim().toLowerCase();
    const normalizedPhone = normalizePhoneNumber(phone_number);

    if (!trimmedName || !trimmedEmail || String(password).length < 8) {
      return res.status(422).json({
        success: false,
        message:
          "Please provide a valid name, email, and a password with at least 8 characters.",
      });
    }

    const duplicate = await checkDuplicateAdminIdentity(
      trimmedEmail,
      normalizedPhone,
    );

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: duplicate.message,
      });
    }

    const { hash } = createPasswordHash(String(password));

    const result = await pool.query(
      `INSERT INTO admin_users
         (full_name, email, phone_number, password_hash, role, provider, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'email', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, full_name, email, phone_number, role, provider, created_at`,
      [trimmedName, trimmedEmail, normalizedPhone, hash, "admin"],
    );

    const user = result.rows[0];
    const token = createToken(user);

    logger.info("ADMIN_SIGNUP_SUCCESS", {
      userId: user.id,
      email: user.email,
    });

    return res.status(201).json({
      success: true,
      message: "Admin account created successfully.",
      data: {
        token,
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          phone_number: user.phone_number,
          role: user.role,
          provider: user.provider,
          created_at: user.created_at,
        },
      },
    });
  } catch (error) {
    logger.error("ADMIN_SIGNUP_ERROR", { error: error.message });
    return res.status(500).json({
      success: false,
      message: "Admin signup failed.",
      errors: { general: "Could not create admin account." },
    });
  }
};

// ============================================================
// POST /api/auth/login  (email + password)
// ============================================================

const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(422).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const trimmedEmail = String(email).trim().toLowerCase();

    const result = await pool.query(
      `SELECT id, full_name, email, phone_number, password_hash, role, provider
       FROM admin_users
       WHERE LOWER(email) = LOWER($1)`,
      [trimmedEmail],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const user = result.rows[0];

    if (user.provider !== "email") {
      return res.status(401).json({
        success: false,
        message: "Please use the social login option for this account.",
      });
    }

    if (!verifyPassword(String(password), user.password_hash)) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // Best-effort update; ignore if column doesn't exist yet
    try {
      await pool.query(
        `UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [user.id],
      );
    } catch (_) {
      // ignore
    }

    const token = createToken(user);

    logger.info("ADMIN_LOGIN_SUCCESS", {
      userId: user.id,
      email: user.email,
    });

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      data: {
        token,
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          phone_number: user.phone_number,
          role: user.role,
          provider: user.provider,
        },
      },
    });
  } catch (error) {
    logger.error("ADMIN_LOGIN_ERROR", { error: error.message });
    return res.status(500).json({
      success: false,
      message: "Admin login failed.",
      errors: { general: "Could not sign in to the admin account." },
    });
  }
};

// ============================================================
// POST /api/auth/social  (google / facebook)
// ============================================================

const loginSocialAdmin = async (req, res) => {
  try {
    const { provider, email, full_name, phone_number, provider_id } =
      req.body || {};

    const normalizedProvider = String(provider || "")
      .trim()
      .toLowerCase();

    if (
      !normalizedProvider ||
      !["google", "facebook"].includes(normalizedProvider)
    ) {
      return res.status(422).json({
        success: false,
        message: "Provider must be google or facebook.",
      });
    }

    const trimmedEmail = String(email || "")
      .trim()
      .toLowerCase();
    const trimmedName = String(full_name || "").trim() || "Admin";
    const normalizedPhone = normalizePhoneNumber(phone_number);

    if (!trimmedEmail) {
      return res.status(422).json({
        success: false,
        message: "Email is required for social login.",
      });
    }

    const existingUser = await pool.query(
      `SELECT id, full_name, email, phone_number, password_hash, role, provider, provider_id
       FROM admin_users
       WHERE LOWER(email) = LOWER($1)`,
      [trimmedEmail],
    );

    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];

      if (
        normalizedPhone &&
        user.phone_number &&
        user.phone_number !== normalizedPhone
      ) {
        const duplicate = await checkDuplicateAdminIdentity(
          trimmedEmail,
          normalizedPhone,
        );
        if (duplicate && duplicate.type === "phone") {
          return res.status(409).json({
            success: false,
            message: duplicate.message,
          });
        }
      }

      if (user.provider !== normalizedProvider) {
        await pool.query(
          `UPDATE admin_users
             SET provider = $1,
                 provider_id = COALESCE($2, provider_id),
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [normalizedProvider, provider_id || user.provider_id, user.id],
        );
      }

      const refreshedUser = {
        ...user,
        provider: normalizedProvider,
        phone_number: user.phone_number || normalizedPhone,
      };

      const token = createToken(refreshedUser);

      return res.status(200).json({
        success: true,
        message: "Social login successful.",
        data: {
          token,
          user: {
            id: refreshedUser.id,
            full_name: refreshedUser.full_name,
            email: refreshedUser.email,
            phone_number: refreshedUser.phone_number,
            role: refreshedUser.role,
            provider: refreshedUser.provider,
          },
        },
      });
    }

    const duplicate = await checkDuplicateAdminIdentity(
      trimmedEmail,
      normalizedPhone,
    );
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: duplicate.message,
      });
    }

    const socialHash = createPasswordHash(
      `${normalizedProvider}:${provider_id || trimmedEmail}`,
    );

    const result = await pool.query(
      `INSERT INTO admin_users
         (full_name, email, phone_number, password_hash, role, provider, provider_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'admin', $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, full_name, email, phone_number, role, provider, provider_id, created_at`,
      [
        trimmedName,
        trimmedEmail,
        normalizedPhone,
        socialHash.hash,
        normalizedProvider,
        provider_id || `${normalizedProvider}:${trimmedEmail}`,
      ],
    );

    const user = result.rows[0];
    const token = createToken(user);

    logger.info("ADMIN_SOCIAL_SIGNUP_SUCCESS", {
      userId: user.id,
      email: user.email,
      provider: normalizedProvider,
    });

    return res.status(201).json({
      success: true,
      message: "Admin account created with social sign-in.",
      data: {
        token,
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          phone_number: user.phone_number,
          role: user.role,
          provider: user.provider,
          created_at: user.created_at,
        },
      },
    });
  } catch (error) {
    logger.error("ADMIN_SOCIAL_AUTH_ERROR", { error: error.message });
    return res.status(500).json({
      success: false,
      message: "Social auth failed.",
      errors: { general: "Could not process social login." },
    });
  }
};

// ============================================================
// GET /api/auth/me  (validate session, return current admin)
// ============================================================
//
// Called by battlenexus.js on every page load to confirm the
// stored token is still valid. Must return:
//   { success: true, data: { user: { ... } } }
// ============================================================

const me = async (req, res) => {
  try {
    // req.user is set by the auth middleware.
    // For admin JWT:   { id, email, role, full_name, type: "admin" }
    // For firebase:    { id, email, display_name, type: "firebase" }
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated.",
      });
    }

    // If it's an admin JWT, fetch the fresh row so the response
    // always reflects the latest DB state (name changes, role, etc.)
    if (req.user.type === "admin") {
      const result = await pool.query(
        `SELECT id, full_name, email, phone_number, role, provider
         FROM admin_users
         WHERE id = $1
         LIMIT 1`,
        [req.user.id],
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          error: "Admin user not found.",
        });
      }

      const user = result.rows[0];

      return res.status(200).json({
        success: true,
        data: {
          user: {
            id: user.id,
            full_name: user.full_name,
            email: user.email,
            phone_number: user.phone_number,
            role: user.role,
            provider: user.provider,
            type: "admin",
          },
        },
      });
    }

    // Firebase user
    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: req.user.id,
          firebase_uid: req.user.firebase_uid,
          email: req.user.email,
          full_name: req.user.display_name || null,
          role: "user",
          type: "firebase",
        },
      },
    });
  } catch (error) {
    logger.error("AUTH_ME_ERROR", { error: error.message });
    return res.status(500).json({
      success: false,
      error: "Could not fetch current user.",
    });
  }
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  signupAdmin,
  loginAdmin,
  loginSocialAdmin,
  me,
  createToken,
};
