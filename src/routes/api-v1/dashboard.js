const express = require("express");
const router = express.Router();
const { pool } = require("../../config/database");
const { authenticate, requireAdminRole } = require("../../middleware/auth");

router.get(
  "/",
  authenticate,
  requireAdminRole([
    "admin",
    "super_admin",
    "tournament_manager",
    "operations_manager",
    "read_only_admin",
  ]),
  async (req, res, next) => {
    try {
      const [players, tournaments, registrations, finance, statuses] =
        await Promise.all([
          pool.query("SELECT COUNT(*)::int AS count FROM users"),
          pool.query("SELECT COUNT(*)::int AS count FROM tournaments"),
          pool.query(
            "SELECT COUNT(*)::int AS count FROM tournament_registrations WHERE status = 'registered'",
          ),
          pool.query(`
            SELECT
              COALESCE(SUM(amount_minor) FILTER (WHERE type = 'topup' AND direction = 'credit' AND status = 'completed'), 0)::bigint AS deposits,
              COALESCE(SUM(amount_minor) FILTER (WHERE type = 'withdrawal' AND status = 'completed'), 0)::bigint AS withdrawals,
              COALESCE(SUM(amount_minor) FILTER (WHERE type = 'tournament_entry' AND direction = 'debit' AND status = 'completed'), 0)::bigint AS entry_volume,
              COALESCE(SUM(amount_minor) FILTER (WHERE type = 'prize' AND direction = 'credit' AND status = 'completed'), 0)::bigint AS prizes,
              COUNT(*) FILTER (WHERE status IN ('pending', 'processing'))::int AS pending,
              COUNT(*) FILTER (WHERE status IN ('failed', 'rejected'))::int AS failed
            FROM wallet_transactions
          `),
          pool.query(
            `SELECT LOWER(status) AS status, COUNT(*)::int AS count
             FROM tournaments
             GROUP BY LOWER(status)
             ORDER BY LOWER(status)`,
          ),
        ]);

      const byStatus = Object.fromEntries(
        statuses.rows.map((row) => [row.status, row.count]),
      );

      return res.status(200).json({
        success: true,
        data: {
          stats: {
            totalPlayers: players.rows[0].count,
            totalTournaments: tournaments.rows[0].count,
            registrations: registrations.rows[0].count,
            upcoming:
              (byStatus.published || 0) +
              (byStatus.scheduled || 0) +
              (byStatus["registration open"] || 0),
            live: byStatus.live || 0,
            completed: byStatus.completed || 0,
            pendingResults: null,
            failedJobs: null,
          },
          finance: {
            deposits: finance.rows[0].deposits,
            withdrawals: finance.rows[0].withdrawals,
            entryVolume: finance.rows[0].entry_volume,
            prizes: finance.rows[0].prizes,
            pending: finance.rows[0].pending,
            failed: finance.rows[0].failed,
          },
          charts: {
            tournamentsByStatus: statuses.rows,
            financeByMonth: [],
          },
          availability: {
            pendingResults: "not_supported_by_current_schema",
            failedJobs: "not_supported_by_current_schema",
            financeByMonth: "not_implemented",
          },
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

module.exports = router;
