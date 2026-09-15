// backend/src/controllers/user.controller.js

const { pool } = require("../config/database");
const { logger } = require("../utils/logger");

// ============================================================
// ⭐ SYNC USER FROM FIREBASE TO POSTGRESQL
// ============================================================

const syncUser = async (req, res) => {
  try {
    const verifiedFirebaseUid = req.user?.firebase_uid || req.user?.uid;
    const {
      firebaseUid: bodyFirebaseUid,
      email,
      displayName,
      gameUid,
    } = req.body;
    const firebaseUid = verifiedFirebaseUid || bodyFirebaseUid;

    console.log("========================================");
    console.log("🔄 SYNCING USER TO POSTGRESQL...");
    console.log("========================================");
    console.log("📊 Firebase UID:", firebaseUid);
    console.log("📧 Email:", email || req.user?.email);
    console.log("👤 Display Name:", displayName || req.user?.display_name);
    console.log("🎮 Game UID:", gameUid);

    if (!firebaseUid) {
      return res.status(400).json({
        success: false,
        error: "firebaseUid is required",
      });
    }

    // Check if user exists
    let userResult = await pool.query(
      `SELECT id, firebase_uid, email, display_name 
       FROM users 
       WHERE firebase_uid = $1`,
      [firebaseUid],
    );

    let user = userResult.rows[0];
    let isNewUser = false;

    if (!user) {
      console.log("📝 USER NOT FOUND - CREATING NEW USER...");

      const insertResult = await pool.query(
        `INSERT INTO users (firebase_uid, email, display_name)
         VALUES ($1, $2, $3)
         RETURNING id, firebase_uid, email, display_name`,
        [firebaseUid, email || null, displayName || null],
      );

      user = insertResult.rows[0];
      isNewUser = true;

      console.log("✅ USER CREATED:", user.id);

      // Create wallet
      await pool.query(
        `INSERT INTO wallets (user_id, balance_minor, currency)
         VALUES ($1, $2, $3)`,
        [user.id, 0, "INR"],
      );

      console.log("✅ WALLET CREATED FOR USER:", user.id);
    } else {
      console.log("✅ USER ALREADY EXISTS:", user.id);
    }

    console.log("========================================");
    console.log("✅ USER SYNCED SUCCESSFULLY");
    console.log("========================================");

    return res.status(200).json({
      success: true,
      message: isNewUser
        ? "User created successfully"
        : "User updated successfully",
      user: {
        id: user.id,
        firebaseUid: user.firebase_uid,
        email: user.email,
        displayName: user.display_name,
        isNewUser,
      },
    });
  } catch (error) {
    console.error("❌ SYNC_USER_ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to sync user to backend",
    });
  }
};

// ============================================================
// ⭐ CHECK USERNAME
// ============================================================

const checkUsername = async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({
        success: false,
        error: "Username is required",
      });
    }

    console.log(`🔍 Checking username: "${username}"`);

    const result = await pool.query(
      `SELECT id FROM users WHERE LOWER(display_name) = LOWER($1)`,
      [username],
    );

    const exists = result.rows.length > 0;

    console.log(exists ? "❌ Username exists" : "✅ Username available");

    return res.status(200).json({
      success: true,
      data: { exists },
    });
  } catch (error) {
    console.error("❌ CHECK USERNAME ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to check username",
    });
  }
};

// ============================================================
// ⭐ CHECK GAME UID
// ============================================================

const checkGameUid = async (req, res) => {
  try {
    const { gameUid } = req.body;

    if (!gameUid) {
      return res.status(400).json({
        success: false,
        error: "Game UID is required",
      });
    }

    console.log(`🔍 Checking game UID: "${gameUid}"`);

    const result = await pool.query(
      `SELECT id FROM users WHERE game_uid = $1`,
      [gameUid],
    );

    const exists = result.rows.length > 0;

    console.log(exists ? "❌ Game UID exists" : "✅ Game UID available");

    return res.status(200).json({
      success: true,
      data: { exists },
    });
  } catch (error) {
    console.error("❌ CHECK GAME UID ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to check game UID",
    });
  }
};

// ============================================================
// ⭐ CHECK EMAIL
// ============================================================

const checkEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    console.log(`🔍 Checking email: "${email}"`);

    const result = await pool.query(`SELECT id FROM users WHERE email = $1`, [
      email,
    ]);

    const exists = result.rows.length > 0;

    console.log(exists ? "❌ Email exists" : "✅ Email available");

    return res.status(200).json({
      success: true,
      data: { exists },
    });
  } catch (error) {
    console.error("❌ CHECK EMAIL ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to check email",
    });
  }
};

// ============================================================
// ⭐ GET USER BALANCE
// ============================================================

const getUserBalance = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated",
      });
    }

    const result = await pool.query(
      `SELECT balance_minor, currency 
       FROM wallets 
       WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        balance: 0,
        currency: "INR",
      });
    }

    const balanceInRupees = result.rows[0].balance_minor / 100;

    return res.status(200).json({
      success: true,
      balance: balanceInRupees,
      currency: result.rows[0].currency,
    });
  } catch (error) {
    console.error("❌ GET BALANCE ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get balance",
    });
  }
};

// ============================================================
// ⭐ GET USER BY FIREBASE UID
// ============================================================

const getUserByFirebaseUid = async (req, res) => {
  try {
    const { firebaseUid } = req.params;

    if (!firebaseUid) {
      return res.status(400).json({
        success: false,
        error: "firebaseUid is required",
      });
    }

    const result = await pool.query(
      `SELECT id, firebase_uid, email, display_name 
       FROM users 
       WHERE firebase_uid = $1`,
      [firebaseUid],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      user: result.rows[0],
    });
  } catch (error) {
    console.error("❌ GET USER ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get user",
    });
  }
};

// ============================================================
// ⭐ CREATE OR UPDATE USER
// ============================================================

const createOrUpdateUser = async (req, res) => {
  try {
    const { firebaseUid, email, displayName, gameUid } = req.body;

    if (!firebaseUid) {
      return res.status(400).json({
        success: false,
        error: "firebaseUid is required",
      });
    }

    let userResult = await pool.query(
      `SELECT id, firebase_uid, email, display_name 
       FROM users 
       WHERE firebase_uid = $1`,
      [firebaseUid],
    );

    let user = userResult.rows[0];

    if (!user) {
      const insertResult = await pool.query(
        `INSERT INTO users (firebase_uid, email, display_name)
         VALUES ($1, $2, $3)
         RETURNING id, firebase_uid, email, display_name`,
        [firebaseUid, email || null, displayName || null],
      );

      user = insertResult.rows[0];

      await pool.query(
        `INSERT INTO wallets (user_id, balance_minor, currency)
         VALUES ($1, $2, $3)`,
        [user.id, 0, "INR"],
      );

      console.log("✅ USER CREATED:", user.id);
    } else {
      console.log("✅ USER EXISTS:", user.id);
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        firebaseUid: user.firebase_uid,
        email: user.email,
        displayName: user.display_name,
      },
    });
  } catch (error) {
    console.error("❌ CREATE/UPDATE USER ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to create/update user",
    });
  }
};

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  syncUser,
  checkUsername,
  checkGameUid,
  checkEmail,
  getUserBalance,
  getUserByFirebaseUid,
  createOrUpdateUser,
};
