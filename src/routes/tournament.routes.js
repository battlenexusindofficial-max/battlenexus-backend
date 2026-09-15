// backend/src/routes/tournament.routes.js

const express = require("express");
const router = express.Router();

const {
  listTournaments,
  getTournament,
  createTournament,
  updateTournament,
  deleteTournament,
} = require("../controllers/tournament.controller");

const { authenticate } = require("../middleware/auth");

// ============================================================
// TOURNAMENT ROUTES
// ============================================================

// GET /api/tournaments
router.get("/", listTournaments);

// POST /api/tournaments
router.post("/", authenticate, createTournament);

// GET /api/tournaments/:id
router.get("/:id", getTournament);

// PUT /api/tournaments/:id
router.put("/:id", authenticate, updateTournament);

// DELETE /api/tournaments/:id
router.delete("/:id", authenticate, deleteTournament);

module.exports = router;
