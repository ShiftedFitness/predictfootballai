-- ============================================================
-- DIAGNOSE_TRIGGER.sql   (READ ONLY — safe, changes nothing)
--
-- 006 has now failed twice on:
--   ERROR 42703: record "new" has no field "updated_at"
--   PL/pgSQL function predict_set_updated_at() line 3 at assignment
--
-- Run all three queries and send back all three results. Between
-- them they say exactly which table is at fault and whether the
-- hardened function was ever actually applied — no more guessing.
-- ============================================================


-- 1. WHICH VERSION OF THE FUNCTION IS LIVE?
--    If the body is two lines (BEGIN / NEW.updated_at = NOW()) this is
--    the ORIGINAL from migration 004, and the failure means the copy of
--    006 that was run did not include the new section 0.
--    If the body contains jsonb_exists(...) then the hardened version IS
--    live, and the fault is elsewhere — query 2 will find it.
SELECT p.proname,
       pg_get_functiondef(p.oid) AS current_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'predict_set_updated_at';


-- 2. EVERY TRIGGER THAT CALLS IT, AND WHETHER ITS TABLE HAS THE COLUMN.
--    Any row where has_updated_at_column = false is a live landmine:
--    the trigger fires on UPDATE and the column it writes to is missing.
SELECT
  c.relname                    AS table_name,
  t.tgname                     AS trigger_name,
  EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'public'
      AND col.table_name   = c.relname
      AND col.column_name  = 'updated_at'
  )                            AS has_updated_at_column
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_proc  p     ON p.oid = t.tgfoid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE p.proname = 'predict_set_updated_at'
  AND NOT t.tgisinternal
  AND n.nspname = 'public'
ORDER BY c.relname;


-- 3. WHICH predict_* TABLES HAVE created_at / updated_at AT ALL.
--    Cross-reference with query 2 to see the full picture.
SELECT
  t.table_name,
  bool_or(c.column_name = 'created_at') AS has_created_at,
  bool_or(c.column_name = 'updated_at') AS has_updated_at
FROM information_schema.tables t
LEFT JOIN information_schema.columns c
  ON c.table_schema = t.table_schema AND c.table_name = t.table_name
WHERE t.table_schema = 'public'
  AND t.table_name LIKE 'predict_%'
  AND t.table_type = 'BASE TABLE'
GROUP BY t.table_name
ORDER BY t.table_name;
