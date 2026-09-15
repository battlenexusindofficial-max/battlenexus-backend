const { pool } = require("../config/database");

class TournamentService {
  static async list() {
    const result = await pool.query(
      `SELECT *
       FROM tournaments
       ORDER BY start_date DESC NULLS LAST, created_at DESC
       LIMIT 50`,
    );

    return result.rows;
  }

  static async create(data) {
    const result = await pool.query(
      `INSERT INTO tournaments (
        name, game, mode, mode_id, type, entry_fee, prize_pool, max_slots,
        registered_players, match_count, start_date, start_time, status,
        description, rules, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        data.name,
        data.game,
        data.mode || "solo",
        data.mode_id || null,
        data.type || "public",
        Number(data.entry_fee || 0),
        Number(data.prize_pool || 0),
        Number(data.max_slots || 0),
        0,
        Number(data.match_count || 0),
        data.start_date || null,
        data.start_time || null,
        data.status || "Published",
        data.description || "",
        data.rules || "",
        data.created_by,
      ],
    );

    return result.rows[0];
  }
}

module.exports = TournamentService;
