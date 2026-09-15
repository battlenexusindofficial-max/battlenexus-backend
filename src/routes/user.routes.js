// backend/src/routes/user.routes.js

const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const {
  syncUser,
  checkUsername,
  checkGameUid,
  checkEmail,
  getUserBalance,
  getUserByFirebaseUid,
  createOrUpdateUser,
} = require("../controllers/user.controller");

// ============================================================
// PUBLIC ROUTES (No Auth Required)
// ============================================================

// Sync user from Firebase to PostgreSQL
router.post("/sync", authenticate, syncUser);

// Check username availability
router.post("/check-username", checkUsername);

// Check game UID availability
router.post("/check-gameuid", checkGameUid);

// Check email availability
router.post("/check-email", checkEmail);

// Create or update user
router.post("/create", createOrUpdateUser);

// ============================================================
// PROTECTED ROUTES (Auth Required)
// ============================================================

// Get user balance
router.get("/balance", authenticate, getUserBalance);

// Get user by Firebase UID
router.get("/:firebaseUid", getUserByFirebaseUid);

module.exports = router;
