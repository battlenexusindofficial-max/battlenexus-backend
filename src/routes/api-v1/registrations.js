const express = require("express");
const router = express.Router();
const { authenticate } = require("../../middleware/auth");
const {
  registerForTournament,
} = require("../../controllers/registration.controller");

router.post("/", authenticate, registerForTournament);

module.exports = router;
