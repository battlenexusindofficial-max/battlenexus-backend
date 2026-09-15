const express = require("express");
const router = express.Router();

const authRoutes = require("./auth");
const walletRoutes = require("./wallet");
const tournamentsRoutes = require("./tournaments");
const registrationsRoutes = require("./registrations");
const matchesRoutes = require("./matches");
const resultsRoutes = require("./results");
const dashboardRoutes = require("./dashboard");
const adminRoutes = require("./admin");

router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: "ok",
      service: "battlenexus-api",
      version: "v1",
      timestamp: new Date().toISOString(),
    },
  });
});

router.use("/auth", authRoutes);
router.use("/wallet", walletRoutes);
router.use("/tournaments", tournamentsRoutes);
router.use("/registrations", registrationsRoutes);
router.use("/matches", matchesRoutes);
router.use("/results", resultsRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/admin", adminRoutes);

module.exports = router;
