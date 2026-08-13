-- Weekly PNL Push tidak idempotent: retry HTTP/cron atau klik ganda tombol
-- "Test Kirim Sekarang" bisa nambah snapshot duplikat buat periode yang sama
-- (insert polos, gak ada unique constraint) — Slack/Email ke-kirim berulang,
-- dan duplikatnya ikut kehitung di baseline "rata-rata 4 minggu" COO Insight
-- (coo-insight-engine.server.ts), bikin baseline-nya bias.
--
-- Kalau kebetulan udah ada duplikat lama, hapus dulu sisain yang paling baru
-- per periode sebelum constraint-nya bisa ditambah.
delete from public.pnl_weekly_snapshots a
using public.pnl_weekly_snapshots b
where a.week_start = b.week_start
  and a.week_end = b.week_end
  and (a.created_at, a.id) < (b.created_at, b.id);

alter table public.pnl_weekly_snapshots
  add constraint pnl_weekly_snapshots_period_unique unique (week_start, week_end);
