-- 005_promo_codes.sql
-- Promo code system for granting Pro tier access
-- Run this against the Supabase database

-- Promo codes table
CREATE TABLE IF NOT EXISTS public.ts_promo_codes (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  max_uses      INTEGER NOT NULL DEFAULT 100,
  current_uses  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,                         -- NULL = never expires
  created_by    TEXT                                  -- optional: who created the code
);

-- Redemption log
CREATE TABLE IF NOT EXISTS public.ts_promo_redemptions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES public.ts_users(id),
  code        TEXT NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, code)
);

-- Index for fast code lookups
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON public.ts_promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_user ON public.ts_promo_redemptions(user_id);

-- RLS: promo_codes readable by all (for validation), writable by service role only
ALTER TABLE public.ts_promo_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "promo_codes_select" ON public.ts_promo_codes FOR SELECT USING (true);

ALTER TABLE public.ts_promo_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "promo_redemptions_select_own" ON public.ts_promo_redemptions
  FOR SELECT USING (true);

-- Add notification preference column to ts_users (for Phase 4 PWA)
ALTER TABLE public.ts_users
  ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN DEFAULT FALSE;

-- ============================================================
-- Example: Insert a promo code (run manually when needed)
-- ============================================================
-- INSERT INTO ts_promo_codes (code, max_uses)
-- VALUES ('LAUNCH2026', 50);
