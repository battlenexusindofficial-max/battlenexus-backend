-- 007_create_tournament_registrations.sql
BEGIN;

CREATE TABLE IF NOT EXISTS tournament_registrations (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'registered',
    entry_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    wallet_transaction_id INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tournament_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_registration_tournament ON tournament_registrations(tournament_id);
CREATE INDEX IF NOT EXISTS idx_registration_user ON tournament_registrations(user_id);

COMMIT;
