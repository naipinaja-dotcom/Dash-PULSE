-- COO Insight sekarang ikut kirim Slack/Email (follow-up ke Weekly PNL Push),
-- simpen status kirimnya sama kayak pnl_weekly_snapshots.push_status biar bisa
-- didebug kalau gagal.
ALTER TABLE public.coo_insight_reports
  ADD COLUMN push_status JSONB;
