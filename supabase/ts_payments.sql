-- ============================================================
-- ts_payments — Track Stripe payment records for Pro upgrades
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- 1. Create the payments table
CREATE TABLE IF NOT EXISTS ts_payments (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES ts_users(id) ON DELETE CASCADE,
  stripe_session_id     TEXT NOT NULL UNIQUE,     -- Stripe Checkout Session ID (cs_...)
  stripe_payment_intent TEXT,                     -- Stripe PaymentIntent ID (pi_...)
  stripe_customer_email TEXT,                     -- Email used at checkout
  amount_total  INTEGER NOT NULL DEFAULT 499,     -- Amount in smallest currency unit (pence)
  currency      TEXT NOT NULL DEFAULT 'gbp',      -- ISO currency code
  status        TEXT NOT NULL DEFAULT 'paid',     -- 'paid', 'unpaid', 'refunded'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_ts_payments_user_id ON ts_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_ts_payments_stripe_session ON ts_payments(stripe_session_id);

-- 3. Row Level Security
ALTER TABLE ts_payments ENABLE ROW LEVEL SECURITY;

-- Service role (Netlify functions) can do everything
-- No public/anon access to payment records
CREATE POLICY "Service role full access on ts_payments"
  ON ts_payments
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Users can view their own payment records (read-only)
CREATE POLICY "Users can view own payments"
  ON ts_payments
  FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM ts_users WHERE auth_id = auth.uid()
    )
  );

-- 4. Grant minimal permissions
GRANT SELECT ON ts_payments TO authenticated;
GRANT ALL ON ts_payments TO service_role;

-- ============================================================
-- DONE! After running this SQL:
--
-- 1. Set these environment variables in Netlify:
--    STRIPE_SECRET_KEY       = sk_live_... (or sk_test_...)
--    STRIPE_WEBHOOK_SECRET   = whsec_...
--
-- 2. In Stripe Dashboard → Developers → Webhooks → Add endpoint:
--    URL: https://telestats.net/.netlify/functions/stripe-webhook
--    Events to listen for: checkout.session.completed
--
-- 3. The webhook secret from step 2 is your STRIPE_WEBHOOK_SECRET
-- ============================================================
