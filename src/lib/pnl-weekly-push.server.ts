// Weekly PNL Push (Fase 2, C.5) — core logic dipakai bareng oleh:
//   - src/routes/api.pnl-weekly-push.ts (dipanggil cron mingguan via HTTP)
//   - src/lib/api/pnl-push.functions.ts (tombol "Test Kirim Sekarang" di admin)
// Server-only: import Supabase admin client + kirim ke Slack/Email di sini.
import { getSupabaseAdmin } from "./supabase-admin.server";
import { getServerConfig } from "./config.server";
import { computePnl, type ClientLite } from "./pnl-engine";
import type { DeliveryRow, AttendanceLogRow } from "./pricing-calc";
import type { PricingScheme } from "./pricing-types";
import { normalize } from "./pricing-store";
import { fetchMolisRevenueCost } from "./molis-cost";
import { sendSlackMessage } from "./notify/slack.server";
import { sendEmail } from "./notify/email.server";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

// Sama seperti fetchAllRows di src/lib/fetch-all.ts, tapi dipakai dengan
// admin client (service role) — fetchAllRows yang browser-side hardcode
// client browser, jadi gak bisa dipakai di server.
async function fetchAllRowsAdmin<T>(
  admin: SupabaseAdmin,
  builder: (client: SupabaseAdmin, from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const results: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await builder(admin, from, from + pageSize - 1);
    if (error) throw error;
    results.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return results;
}

// Minggu kalender PENUH (Senin-Minggu) yang paling baru KELAR per tanggal
// panggil — bukan rolling 7 hari trailing dari "sekarang". Cron jalan Senin
// 00:00 UTC (07:00 WIB): rolling-trailing yang lama nyangkut separuh Senin
// ini (datanya nyaris kosong, baru mulai detik itu) DAN ngelewatin Senin
// minggu lalu sama sekali (window jadi geser 1 hari). Dihitung generik biar
// tetap benar juga kalau dipanggil manual (tombol "Test Kirim Sekarang") di
// hari selain Senin — selalu mundur ke Minggu terakhir yang beneran kelar.
export function defaultWeekRange(): { weekStart: string; weekEnd: string } {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Minggu,1=Senin,...,6=Sabtu
  const daysSinceLastCompletedSunday = day === 0 ? 7 : day;
  const end = new Date(now);
  end.setUTCDate(now.getUTCDate() - daysSinceLastCompletedSunday);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { weekStart: fmt(start), weekEnd: fmt(end) };
}

const jt = (n: number) => "Rp " + (n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " jt";
const rp = (n: number) => "Rp" + Math.round(n).toLocaleString("id-ID");

function buildSlackText(weekStart: string, weekEnd: string, perClient: ReturnType<typeof computePnl>["perClient"]) {
  const totRevenue = perClient.reduce((s, r) => s + (r.revenue ?? 0), 0);
  const totCost = perClient.reduce((s, r) => s + r.cost, 0);
  const totMargin = totRevenue - totCost;
  const totPct = totRevenue > 0 ? (totMargin / totRevenue) * 100 : 0;
  const rugi = perClient.filter((r) => r.revenue !== null && (r.marginPct ?? 0) < 0);

  const lines = [
    `*📊 Weekly PNL — ${weekStart} → ${weekEnd}*`,
    `Revenue: *${jt(totRevenue)}*  |  Cost: *${jt(totCost)}*  |  Margin: *${jt(totMargin)}* (${totPct.toFixed(1)}%)`,
  ];
  if (rugi.length > 0) {
    lines.push(`⚠️ ${rugi.length} client RUGI minggu ini: ${rugi.map((r) => r.client).join(", ")}`);
  }
  return lines.join("\n");
}

function buildEmailHtml(weekStart: string, weekEnd: string, perClient: ReturnType<typeof computePnl>["perClient"]) {
  const totRevenue = perClient.reduce((s, r) => s + (r.revenue ?? 0), 0);
  const totCost = perClient.reduce((s, r) => s + r.cost, 0);
  const totMargin = totRevenue - totCost;
  const totPct = totRevenue > 0 ? (totMargin / totRevenue) * 100 : 0;
  const rows = perClient
    .slice()
    .sort((a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity))
    .map((r) => {
      const loss = r.marginPct !== null && r.marginPct < 0;
      const color = r.revenue === null ? "#666" : loss ? "#c0392b" : "#1a7f37";
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${r.client}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${r.revenue === null ? "—" : rp(r.revenue)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${rp(r.cost)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:${color}">${r.margin === null ? "—" : rp(r.margin)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:${color}">${r.marginPct === null ? "—" : r.marginPct.toFixed(1) + "%"}</td>
      </tr>`;
    })
    .join("");

  return `
  <div style="font-family:sans-serif;max-width:640px;margin:0 auto">
    <h2>Weekly PNL — ${weekStart} → ${weekEnd}</h2>
    <p>Revenue: <b>${rp(totRevenue)}</b> &nbsp; Cost: <b>${rp(totCost)}</b> &nbsp; Margin: <b>${rp(totMargin)}</b> (${totPct.toFixed(1)}%)</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead>
        <tr style="background:#f5f5f5;text-align:left">
          <th style="padding:6px 10px">Client</th>
          <th style="padding:6px 10px;text-align:right">Revenue</th>
          <th style="padding:6px 10px;text-align:right">Cost</th>
          <th style="padding:6px 10px;text-align:right">Margin</th>
          <th style="padding:6px 10px;text-align:right">Margin %</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#888;font-size:12px;margin-top:16px">Dikirim otomatis oleh Dash PULSE — Weekly PNL Push.</p>
  </div>`;
}

export interface WeeklyPnlPushResult {
  weekStart: string;
  weekEnd: string;
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  totalMarginPct: number;
  pushStatus: { slack: { ok: boolean; error?: string }; email: { ok: boolean; error?: string } };
  snapshotId: string;
}

export async function runWeeklyPnlPush(opts: {
  triggeredBy: "cron" | "manual";
  triggeredByUserId?: string;
  weekStart?: string;
  weekEnd?: string;
}): Promise<WeeklyPnlPushResult> {
  const admin = getSupabaseAdmin();
  const { weekStart, weekEnd } = opts.weekStart && opts.weekEnd
    ? { weekStart: opts.weekStart, weekEnd: opts.weekEnd }
    : defaultWeekRange();

  const [deliveries, attendance, { data: schemesRaw, error: schemesErr }, { data: clientsRaw, error: clientsErr }, molisCost] =
    await Promise.all([
      fetchAllRowsAdmin<DeliveryRow & { client_id: string | null }>(admin, (c, from, to) =>
        (c as any).from("delivery_records")
          .select("client_id, rider_id, driver_code, delivery_date, district, distance_km, weight_kg, destination_address, service_type, status, delivery_type")
          .gte("delivery_date", weekStart).lte("delivery_date", weekEnd).range(from, to)),
      fetchAllRowsAdmin<AttendanceLogRow & { client_name: string | null }>(admin, (c, from, to) =>
        (c as any).from("attendance_logs")
          .select("rider_id, driver_code, client_name, log_date, clock_in, duration_minutes, is_late, is_absent")
          .gte("log_date", weekStart).lte("log_date", weekEnd).range(from, to)),
      (admin as any).from("pricing_schemes")
        .select("id, name, client_id, scheme_for, calc_type, effective_from, effective_to, params, created_at"),
      admin.from("clients").select("id, name"),
      // Biaya molis charge_target='client_revenue' (lihat molis-cost.ts) — dashboard
      // Margin Analytics (admin.pnl-dashboard.tsx) udah masukin ini ke computePnl,
      // tapi job mingguan ini dulu enggak, jadi cost-nya ke-bawah-hitung tiap minggu.
      fetchMolisRevenueCost(weekStart, weekEnd, admin as any),
    ]);
  // pricing_schemes/clients gagal fetch dulu diam-diam jadi array kosong (data
  // null ?? []) — delivery/attendance di atas udah fail-fast lewat
  // fetchAllRowsAdmin, dua query ini disamain biar gak diam-diam ngirim
  // laporan "sukses" dengan revenue/cost kosong/salah pas query-nya sendiri
  // sebenarnya gagal.
  if (schemesErr) throw new Error(`Gagal ambil pricing_schemes: ${(schemesErr as Error).message}`);
  if (clientsErr) throw new Error(`Gagal ambil clients: ${(clientsErr as Error).message}`);

  // normalize() derives category/subtype from calc_type — tanpa ini semua
  // scheme.category jadi undefined, computePnl gak akan bisa dispatch ke
  // calcAttendanceScheme/calcHybridScheme sama sekali.
  const schemes: PricingScheme[] = (schemesRaw ?? []).map(normalize);
  const clients = (clientsRaw ?? []) as ClientLite[];
  // asOfDate = weekEnd (BUKAN default hari ini) — laporan periode lama yang
  // di-backfill/rerun harus pakai skema yang berlaku PAS periode itu, bukan
  // skema yang aktif hari job-nya dijalanin (lihat pnl-engine.ts).
  const { perClient, totRevenue, totCost, totMargin, totMarginPct } = computePnl(
    deliveries, schemes, clients, attendance, molisCost, weekEnd,
  );

  const slackResult = await sendSlackMessage(buildSlackText(weekStart, weekEnd, perClient));
  const emailResult = await sendEmail({
    subject: `Weekly PNL — ${weekStart} → ${weekEnd}`,
    html: buildEmailHtml(weekStart, weekEnd, perClient),
  });

  const pushStatus = { slack: slackResult, email: emailResult };

  // upsert (bukan insert polos) — retry HTTP/cron atau klik ganda "Test Kirim
  // Sekarang" buat periode yang SAMA menimpa snapshot lama, bukan nambah
  // baris duplikat (lihat migration pnl_weekly_snapshots_unique_period untuk
  // constraint-nya, dan komentar di coo-insight-engine.server.ts soal baseline
  // 4-minggu yang kena bias kalau ada duplikat).
  const { data: snapshot, error: insErr } = await (admin as any)
    .from("pnl_weekly_snapshots")
    .upsert(
      {
        week_start: weekStart,
        week_end: weekEnd,
        total_revenue: totRevenue,
        total_cost: totCost,
        total_margin: totMargin,
        total_margin_pct: totMarginPct,
        per_client: perClient.map((r) => ({
          client_id: r.clientId, client: r.client, revenue: r.revenue, cost: r.cost, margin: r.margin, marginPct: r.marginPct,
        })),
        push_status: pushStatus,
        triggered_by: opts.triggeredBy,
        triggered_by_user: opts.triggeredByUserId ?? null,
      },
      { onConflict: "week_start,week_end" },
    )
    .select("id")
    .single();
  if (insErr) throw new Error(`Gagal simpan snapshot: ${insErr.message}`);

  // Snapshot udah aman tersimpan di atas (angkanya gak hilang) — tapi kalau
  // KEDUA channel notifikasi gagal, ini WAJIB bikin request-nya gagal (bukan
  // diam-diam 200 OK), biar cron/monitoring ke-alert. Endpoint HTTP-nya
  // (api.pnl-weekly-push.ts) balikin 500 kalau ini throw.
  if (!slackResult.ok && !emailResult.ok) {
    throw new Error(
      `Snapshot tersimpan tapi Slack & Email dua-duanya gagal terkirim — Slack: ${slackResult.error}; Email: ${emailResult.error}`,
    );
  }

  return {
    weekStart, weekEnd, totalRevenue: totRevenue, totalCost: totCost, totalMargin: totMargin, totalMarginPct: totMarginPct,
    pushStatus, snapshotId: snapshot.id,
  };
}

export function verifyPnlPushSecret(headerValue: string | null): boolean {
  const expected = getServerConfig().pnlPushSecret;
  if (!expected) return false;
  return !!headerValue && headerValue === expected;
}
