-- 003_create_topup_orders.sql
BEGIN;

CREATE TABLE IF NOT EXISTS wallet_topup_orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reference VARCHAR(50) UNIQUE NOT NULL,
    razorpay_order_id VARCHAR(100) UNIQUE NOT NULL,
    razorpay_payment_id VARCHAR(100),
    amount_minor INTEGER NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    environment VARCHAR(10) NOT NULL DEFAULT 'test',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_topup_orders_user_id ON wallet_topup_orders(user_id);
CREATE INDEX idx_topup_orders_razorpay_order_id ON wallet_topup_orders(razorpay_order_id);
CREATE INDEX idx_topup_orders_razorpay_payment_id ON wallet_topup_orders(razorpay_payment_id);
CREATE INDEX idx_topup_orders_status ON wallet_topup_orders(status);

ALTER TABLE wallet_topup_orders 
ADD CONSTRAINT check_status CHECK (status IN ('pending', 'processing', 'successful', 'failed', 'refunded'));

COMMIT;