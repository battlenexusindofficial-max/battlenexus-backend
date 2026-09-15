BEGIN;

ALTER TABLE wallet_topup_orders
  ADD COLUMN IF NOT EXISTS zapupi_utr VARCHAR(100),
  ADD COLUMN IF NOT EXISTS provider_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP WITH TIME ZONE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_transactions_zapupi_transaction_id
  ON wallet_transactions(zapupi_transaction_id)
  WHERE zapupi_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_transactions_provider_reference
  ON wallet_transactions(provider_reference)
  WHERE provider_reference IS NOT NULL;

COMMIT;