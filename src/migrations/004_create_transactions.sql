-- 004_create_transactions.sql
BEGIN;

CREATE TABLE IF NOT EXISTS wallet_transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    type VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    provider VARCHAR(20),
    provider_reference VARCHAR(100),
    razorpay_order_id VARCHAR(100),
    razorpay_payment_id VARCHAR(100),
    reference VARCHAR(50) UNIQUE,
    balance_before_minor INTEGER NOT NULL,
    balance_after_minor INTEGER NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transactions_user_id ON wallet_transactions(user_id);
CREATE INDEX idx_transactions_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX idx_transactions_provider_reference ON wallet_transactions(provider_reference);
CREATE INDEX idx_transactions_razorpay_order_id ON wallet_transactions(razorpay_order_id);
CREATE INDEX idx_transactions_razorpay_payment_id ON wallet_transactions(razorpay_payment_id);
CREATE INDEX idx_transactions_created_at ON wallet_transactions(created_at DESC);

ALTER TABLE wallet_transactions ADD CONSTRAINT check_balance_after_non_negative CHECK (balance_after_minor >= 0);

COMMIT;