-- 006_create_tournaments.sql
BEGIN;

CREATE TABLE IF NOT EXISTS tournaments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    game VARCHAR(255) NOT NULL,
    mode VARCHAR(50) NOT NULL DEFAULT 'solo',
    mode_id INTEGER,
    type VARCHAR(50) NOT NULL DEFAULT 'public',
    entry_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    prize_pool NUMERIC(12,2) NOT NULL DEFAULT 0,
    max_slots INTEGER NOT NULL DEFAULT 0,
    registered_players INTEGER NOT NULL DEFAULT 0,
    match_count INTEGER NOT NULL DEFAULT 0,
    start_date DATE,
    start_time TIME,
    status VARCHAR(50) NOT NULL DEFAULT 'Published',
    description TEXT,
    rules TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_tournaments_game ON tournaments(game);
CREATE INDEX IF NOT EXISTS idx_tournaments_start_date ON tournaments(start_date);

COMMIT;
