const express = require("express");
const router = express.Router();
const { authenticate } = require("../../middleware/auth");
const {
  listTournaments,
  getTournament,
  createTournament,
} = require("../../controllers/tournament.controller");

router.get("/", listTournaments);
router.post("/", authenticate, createTournament);
router.get("/:id", getTournament);

module.exports = router;
