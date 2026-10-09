-- Rapihin sesuai saran Supabase advisor (semua perilaku tetap, cuma lebih efisien):
-- 1) RLS initplan: auth.uid() dkk dibungkus (select ...) supaya dievaluasi sekali
--    per query, bukan per baris. Semantik policy IDENTIK.
-- 2) Index untuk foreign key yang belum punya index penutup (percepat join dan
--    cascade delete). Idempoten — aman dijalankan ulang.
-- Rollback RLS: ganti balik '( SELECT auth.uid() AS uid)' jadi 'auth.uid()'.

DO $$
DECLARE
  p record;
  new_qual text;
  new_check text;
  stmt text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual, '') || coalesce(with_check, ''))
          ~ '(?<!SELECT )auth\.(uid|role|jwt|email)\(\)'
  LOOP
    new_qual  := regexp_replace(p.qual,       '(?<!SELECT )auth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'g');
    new_check := regexp_replace(p.with_check, '(?<!SELECT )auth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'g');
    stmt := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    IF new_qual  IS NOT NULL THEN stmt := stmt || format(' USING (%s)', new_qual); END IF;
    IF new_check IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', new_check); END IF;
    EXECUTE stmt;
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl,
           c.conname,
           (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord)
              FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND i.indisvalid
          AND (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(c.conkey, 1)] = c.conkey
      )
  LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%s)', left(r.conname, 58) || '_idx', r.tbl, r.cols);
  END LOOP;
END $$;
