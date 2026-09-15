const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Results endpoint is available.",
    data: {
      results: [],
      total: 0,
    },
  });
});

router.get("/:id", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Result detail endpoint is available.",
    data: {
      id: req.params.id,
      status: "Pending",
      verified: false,
    },
  });
});

module.exports = router;
