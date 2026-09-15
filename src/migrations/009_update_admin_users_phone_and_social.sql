BEGIN;

ALTER TABLE admin_users
    ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50);

ALTER TABLE admin_users
    ADD COLUMN IF NOT EXISTS provider VARCHAR(30) NOT NULL DEFAULT 'email';

ALTER TABLE admin_users
    ADD COLUMN IF NOT EXISTS provider_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_phone_unique
    ON admin_users(phone_number)
    WHERE phone_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_users_provider ON admin_users(provider);

COMMIT;
