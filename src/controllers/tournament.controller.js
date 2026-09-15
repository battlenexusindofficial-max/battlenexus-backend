// backend/src/controllers/tournament.controller.js

const { pool } = require("../config/database");
const { logger } = require("../utils/logger");

const normalizeAmount = (value) => {
  const raw = Number(value ?? 0);
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, raw);
};

const toNullableInt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

// ------------------------------------------------------------
// LIST TOURNAMENTS
// ------------------------------------------------------------
const listTournaments = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM tournaments
       ORDER BY start_date DESC NULLS LAST, created_at DESC
       LIMIT 50`,
    );

    return res.status(200).json({
      success: true,
      message: "Tournaments retrieved successfully.",
      data: {
        tournaments: result.rows,
        pagination: {
          page: 1,
          limit: 50,
          total: result.rows.length,
        },
      },
    });
  } catch (error) {
    logger.error("LIST_TOURNAMENTS_ERROR", {
      message: error.message,
      code: error.code,
      detail: error.detail,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tournaments.",
      errors: { general: "Could not load tournaments." },
    });
  }
};

// ------------------------------------------------------------
// GET TOURNAMENT
// ------------------------------------------------------------
const getTournament = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT *
       FROM tournaments
       WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Tournament retrieved successfully.",
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("GET_TOURNAMENT_ERROR", {
      message: error.message,
      code: error.code,
      detail: error.detail,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tournament.",
      errors: { general: "Could not load tournament." },
    });
  }
};

// ------------------------------------------------------------
// CREATE TOURNAMENT
// ------------------------------------------------------------
const createTournament = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!req.user.id) {
      logger.error("CREATE_TOURNAMENT_NO_USER_ID", { user: req.user });
      return res.status(401).json({
        success: false,
        message: "Authenticated user is missing database id.",
      });
    }

    const payload = req.body || {};
    const name = String(payload.name || "").trim();
    const game = String(payload.game || "").trim();

    if (!name || !game) {
      return res.status(422).json({
        success: false,
        message: "Tournament name and game are required.",
        errors: {
          name: !name ? "Name is required." : undefined,
          game: !game ? "Game is required." : undefined,
        },
      });
    }

    const entryFee = normalizeAmount(payload.entry_fee ?? payload.entryFee);
    const prizePool = normalizeAmount(payload.prize_pool ?? payload.prizePool);
    const maxSlots = Number(payload.max_slots ?? payload.maxSlots ?? 0);
    const matchCount = Number(payload.match_count ?? payload.matchCount ?? 1);
    const startDate = payload.start_date || payload.startDate || null;
    const startTime = payload.start_time || payload.startTime || null;
    const status = String(payload.status || "Published").trim();
    const description = String(payload.description || "").trim();
    const rules = String(payload.rules || "").trim();
    const mode = String(payload.mode || "solo").trim();
    const modeId = toNullableInt(payload.mode_id ?? payload.modeId);
    const type = String(payload.type || "public").trim();

    const result = await pool.query(
      `INSERT INTO tournaments (
        name, game, mode, mode_id, type, entry_fee, prize_pool, max_slots,
        registered_players, match_count, start_date, start_time, status,
        description, rules, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *`,
      [
        name,
        game,
        mode,
        modeId,
        type,
        entryFee,
        prizePool,
        Number.isFinite(maxSlots) ? maxSlots : 0,
        0,
        Number.isFinite(matchCount) ? matchCount : 1,
        startDate,
        startTime,
        status,
        description,
        rules,
        req.user.id,
      ],
    );

    return res.status(201).json({
      success: true,
      message: "Tournament created successfully.",
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("CREATE_TOURNAMENT_ERROR", {
      userId: req.user?.id,
      message: error.message,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint,
      table: error.table,
      column: error.column,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      message: "Failed to create tournament.",
      errors: { general: "Could not create tournament." },
    });
  }
};

// ------------------------------------------------------------
// UPDATE TOURNAMENT
// ------------------------------------------------------------
const updateTournament = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const { id } = req.params;
    const payload = req.body || {};

    const existing = await pool.query(
      `SELECT * FROM tournaments WHERE id = $1`,
      [id],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found.",
      });
    }

    const current = existing.rows[0];

    const name =
      payload.name !== undefined ? String(payload.name).trim() : current.name;
    const game =
      payload.game !== undefined ? String(payload.game).trim() : current.game;
    const mode =
      payload.mode !== undefined ? String(payload.mode).trim() : current.mode;
    const type =
      payload.type !== undefined ? String(payload.type).trim() : current.type;
    const status =
      payload.status !== undefined
        ? String(payload.status).trim()
        : current.status;
    const description =
      payload.description !== undefined
        ? String(payload.description).trim()
        : current.description;
    const rules =
      payload.rules !== undefined
        ? String(payload.rules).trim()
        : current.rules;

    const entryFee =
      payload.entry_fee !== undefined || payload.entryFee !== undefined
        ? normalizeAmount(payload.entry_fee ?? payload.entryFee)
        : current.entry_fee;
    const prizePool =
      payload.prize_pool !== undefined || payload.prizePool !== undefined
        ? normalizeAmount(payload.prize_pool ?? payload.prizePool)
        : current.prize_pool;
    const maxSlots =
      payload.max_slots !== undefined || payload.maxSlots !== undefined
        ? Number(payload.max_slots ?? payload.maxSlots ?? 0)
        : current.max_slots;
    const matchCount =
      payload.match_count !== undefined || payload.matchCount !== undefined
        ? Number(payload.match_count ?? payload.matchCount ?? 1)
        : current.match_count;
    const startDate =
      payload.start_date ?? payload.startDate ?? current.start_date;
    const startTime =
      payload.start_time ?? payload.startTime ?? current.start_time;
    const modeId =
      payload.mode_id !== undefined || payload.modeId !== undefined
        ? toNullableInt(payload.mode_id ?? payload.modeId)
        : current.mode_id;

    const result = await pool.query(
      `UPDATE tournaments SET
        name = $1,
        game = $2,
        mode = $3,
        mode_id = $4,
        type = $5,
        entry_fee = $6,
        prize_pool = $7,
        max_slots = $8,
        match_count = $9,
        start_date = $10,
        start_time = $11,
        status = $12,
        description = $13,
        rules = $14,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $15
      RETURNING *`,
      [
        name,
        game,
        mode,
        modeId,
        type,
        entryFee,
        prizePool,
        Number.isFinite(maxSlots) ? maxSlots : 0,
        Number.isFinite(matchCount) ? matchCount : 1,
        startDate,
        startTime,
        status,
        description,
        rules,
        id,
      ],
    );

    return res.status(200).json({
      success: true,
      message: "Tournament updated successfully.",
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("UPDATE_TOURNAMENT_ERROR", {
      userId: req.user?.id,
      message: error.message,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint,
      table: error.table,
      column: error.column,
    });

    return res.status(500).json({
      success: false,
      message: "Failed to update tournament.",
      errors: { general: "Could not update tournament." },
    });
  }
};

// ------------------------------------------------------------
// DELETE TOURNAMENT
// ------------------------------------------------------------
const deleteTournament = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM tournaments WHERE id = $1 RETURNING id`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Tournament deleted successfully.",
      data: { id },
    });
  } catch (error) {
    logger.error("DELETE_TOURNAMENT_ERROR", {
      userId: req.user?.id,
      message: error.message,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint,
      table: error.table,
    });

    return res.status(500).json({
      success: false,
      message: "Failed to delete tournament.",
      errors: { general: "Could not delete tournament." },
    });
  }
};

module.exports = {
  listTournaments,
  getTournament,
  createTournament,
  updateTournament,
  deleteTournament,
};
