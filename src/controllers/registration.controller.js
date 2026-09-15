const { pool } = require("../config/database");
const { logger } = require("../utils/logger");

const registerForTournament = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const tournamentId = Number(
      req.body?.tournament_id ?? req.body?.tournamentId,
    );
    if (!Number.isFinite(tournamentId)) {
      return res.status(422).json({
        success: false,
        message: "Tournament selection is required.",
        errors: { tournament_id: "A valid tournament is required." },
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const tournamentRes = await client.query(
        `SELECT id, status, entry_fee, max_slots, registered_players
         FROM tournaments
         WHERE id = $1
         FOR UPDATE`,
        [tournamentId],
      );

      if (tournamentRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: "Tournament not found.",
        });
      }

      const tournament = tournamentRes.rows[0];
      const entryFee = Number(tournament.entry_fee || 0);

      if (
        ![
          "Published",
          "Registration Open",
          "Registration Closed",
          "Scheduled",
        ].includes(tournament.status)
      ) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "Tournament is not accepting registrations.",
        });
      }

      const duplicateRes = await client.query(
        `SELECT id
         FROM tournament_registrations
         WHERE tournament_id = $1 AND user_id = $2`,
        [tournamentId, req.user.id],
      );

      if (duplicateRes.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "You are already registered for this tournament.",
        });
      }

      if (
        tournament.max_slots > 0 &&
        tournament.registered_players >= tournament.max_slots
      ) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "Tournament is full.",
        });
      }

      const walletRes = await client.query(
        `SELECT id, balance_minor
         FROM wallets
         WHERE user_id = $1
         FOR UPDATE`,
        [req.user.id],
      );

      if (walletRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: "Wallet not found.",
        });
      }

      const wallet = walletRes.rows[0];
      const balanceMinor = Number(wallet.balance_minor || 0);
      if (balanceMinor < entryFee * 100) {
        await client.query("ROLLBACK");
        return res.status(422).json({
          success: false,
          message: "Insufficient wallet balance for tournament entry.",
        });
      }

      const newBalanceMinor = balanceMinor - entryFee * 100;
      await client.query(
        `UPDATE wallets
         SET balance_minor = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [newBalanceMinor, wallet.id],
      );

      const txnRes = await client.query(
        `INSERT INTO wallet_transactions (
          user_id, wallet_id, type, direction, amount_minor, currency,
          status, provider, provider_reference, reference, balance_before_minor,
          balance_after_minor, metadata, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id`,
        [
          req.user.id,
          wallet.id,
          "tournament_entry",
          "debit",
          entryFee * 100,
          "INR",
          "completed",
          "system",
          `tournament-${tournamentId}`,
          `REG-${tournamentId}-${req.user.id}-${Date.now()}`,
          balanceMinor,
          newBalanceMinor,
          JSON.stringify({ tournament_id: tournamentId, type: "entry_fee" }),
        ],
      );

      await client.query(
        `INSERT INTO tournament_registrations (
          tournament_id, user_id, status, entry_fee, wallet_transaction_id,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [tournamentId, req.user.id, "registered", entryFee, txnRes.rows[0].id],
      );

      await client.query(
        `UPDATE tournaments
         SET registered_players = registered_players + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [tournamentId],
      );

      await client.query("COMMIT");

      return res.status(200).json({
        success: true,
        message: "Tournament registration successful.",
        data: {
          tournamentId,
          walletBalance: newBalanceMinor / 100,
          registered: true,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error("REGISTER_TOURNAMENT_ERROR", {
      userId: req.user?.id,
      error: error.message,
    });
    return res.status(500).json({
      success: false,
      message: "Tournament registration failed.",
      errors: { general: "Could not complete tournament registration." },
    });
  }
};

module.exports = {
  registerForTournament,
};
