-- 008_rename_razorpay_to_zapupi.sql
BEGIN;

ALTER TABLE wallet_topup_orders RENAME COLUMN razorpay_order_id TO zapupi_order_id;
ALTER TABLE wallet_topup_orders RENAME COLUMN razorpay_payment_id TO zapupi_payment_id;

ALTER TABLE wallet_transactions RENAME COLUMN razorpay_order_id TO zapupi_order_id;
ALTER TABLE wallet_transactions RENAME COLUMN razorpay_payment_id TO zapupi_payment_id;

ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS zapupi_transaction_id VARCHAR(100);

DROP INDEX IF EXISTS idx_topup_orders_razorpay_order_id;
DROP INDEX IF EXISTS idx_topup_orders_razorpay_payment_id;
DROP INDEX IF EXISTS idx_transactions_razorpay_order_id;
DROP INDEX IF EXISTS idx_transactions_razorpay_payment_id;

CREATE INDEX idx_topup_orders_zapupi_order_id ON wallet_topup_orders(zapupi_order_id);
CREATE INDEX idx_topup_orders_zapupi_payment_id ON wallet_topup_orders(zapupi_payment_id);
CREATE INDEX idx_transactions_zapupi_order_id ON wallet_transactions(zapupi_order_id);
CREATE INDEX idx_transactions_zapupi_transaction_id ON wallet_transactions(zapupi_transaction_id);

COMMIT;