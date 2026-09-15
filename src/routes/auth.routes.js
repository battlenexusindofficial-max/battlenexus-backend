// backend/src/routes/auth.routes.js

const express = require("express");
const router = express.Router();

const {
  signupAdmin,
  loginAdmin,
  loginSocialAdmin,
  me,
} = require("../controllers/auth.controller");

const { authenticate } = require("../middleware/auth");
const { rateLimiter } = require("../middleware/rateLimiter");

// ============================================================
// PUBLIC ROUTES
// ============================================================

// POST /api/auth/signup
router.post("/signup", rateLimiter(60000, 10), signupAdmin);

// POST /api/auth/register  (alias for /signup — both work)
router.post("/register", rateLimiter(60000, 10), signupAdmin);

// POST /api/auth/login
router.post("/login", rateLimiter(60000, 10), loginAdmin);

// POST /api/auth/social
router.post("/social", rateLimiter(60000, 10), loginSocialAdmin);

// ============================================================
// PROTECTED ROUTES
// ============================================================

// GET /api/auth/me
router.get("/me", authenticate, me);

module.exports = router;
