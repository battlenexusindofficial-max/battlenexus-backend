const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { pool } = require("../../config/database");
const {
  signupAdmin,
  loginAdmin,
  loginSocialAdmin,
} = require("../../controllers/auth.controller");
const { rateLimiter } = require("../../middleware/rateLimiter");

const JWT_SECRET = process.env.JWT_SECRET || "battlenexus-admin-secret";

router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      service: "auth",
      status: "ok",
      version: "v1",
    },
  });
});

router.post("/signup", rateLimiter(60000, 10), signupAdmin);
router.post("/login", rateLimiter(60000, 10), loginAdmin);
router.post("/social", rateLimiter(60000, 10), loginSocialAdmin);

router.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authorization header required.",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      "SELECT id, full_name, email, phone_number, role, provider FROM admin_users WHERE id = $1",
      [decoded.sub],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Admin user not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        user: result.rows[0],
      },
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
});

module.exports = router;
