const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Matches endpoint is available.",
    data: {
      matches: [],
      total: 0,
    },
  });
});

router.get("/:id", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Match detail endpoint is available.",
    data: {
      id: req.params.id,
      status: "Scheduled",
      scheduledAt: null,
      roomStatus: "Pending",
    },
  });
});

module.exports = router;
