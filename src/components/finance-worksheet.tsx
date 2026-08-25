import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";
import { toCSV, downloadCSV } from "@/lib/csv";
import { fetchAllRows } from "@/lib/fetch-all";
import { listPricingSchemes } from "@/lib/pricing-store";
import { describeScheme, type RateCard } from "@/lib/rate-card";
import { calcAttendanceComponent, findShiftFor, type AttendanceLogRow } from "@/lib/pricing-calc";
import { downloadXLS, rateCardsToRows, type Cell } from "@/lib/finance-export";
import {
  type DelivDetail, type AttDetail, type RiderRow, rp, otpLabel, durLabel,
  isAttendanceOnlyRun, attendanceDetailRows, attendanceSummaryRows,
} from "@/lib/attendance-worksheet-export";
import { getClientExportTemplate, ALL_EXPORT_COLUMN_KEYS } from "@/lib/export-template";
import { allocateKasbonByRecipient, type KasbonDeductionRow } from "@/lib/kasbon-allocation";
import { toast } from "sonner";
import { Download, Loader2, ChevronRight, FileSpreadsheet, ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/i18n";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type Run = { id: string; name: string; period_start: string; period_end: string; status: string; client_id?: string | null };

export function FinanceWorksheet({ runId, run }: { runId: string; run?: Run }) {
  const { t: tr } = useT();
  const [rows, setRows] = useState<RiderRow[]>([]);
  const [dedTypes, setDedTypes] = useState<string[]>([]);
  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showRates, setShowRates] = useState(true);
  // Kolom Ringkasan yang enabled — dari client_export_templates kalau run
  // ini di-scope ke 1 client (run.client_id), fallback semua kolom kalau
  // run "semua client" atau client belum setup template. Lihat lib/export-template.ts.
  const [enabledCols, setEnabledCols] = useState<Set<string>>(new Set(ALL_EXPORT_COLUMN_KEYS));

  useEffect(() => {
    if (run?.client_id) {
      getClientExportTemplate(run.client_id).then((cols) => setEnabledCols(new Set(cols ?? ALL_EXPORT_COLUMN_KEYS)));
    } else {
      setEnabledCols(new Set(ALL_EXPORT_COLUMN_KEYS));
    }
  }, [run?.client_id]);

  useEffect(() => {
    if (!run) return;
    (async () => {
      setLoading(true);
      try {
        // Ditarik dari report_summary_weekly (canonical source), bukan
        // langsung ke payroll_details — biar konsisten sama ClientReport.
        // `id:detail_id` biar bentuk objeknya gak berubah dari sebelumnya.
        const { data: details, error: e1 } = await sb.from("report_summary_weekly")
          .select("id:detail_id, rider_id, client_id, delivery_count, gross_earning, net_pay, remarks, rider_name, rider_employee_id, client_name, incentive")
          .eq("run_id", runId);
        if (e1) throw e1;

        // Skema rider (attendance) dipindah ke sini (sebelum attByRider dibangun)
        // — dibutuhkan buat replay findShiftFor/calcAttendanceComponent per baris
        // attendance (label shift + pecah base/overtime vs insentif ontime buat
        // Ringkasan). Skema yang sama juga dipakai lagi di bawah buat Rate Card.
        const clientIds = new Set<string>((details ?? []).map((d: { client_id: string | null }) => d.client_id).filter(Boolean) as string[]);
        const allSchemes = await listPricingSchemes();
        const riderSchemes = allSchemes.filter((s) => s.scheme_for === "rider" && (s.client_id === null || clientIds.has(s.client_id)));
        const attSchemeByClient = new Map<string, (typeof riderSchemes)[number]>();
        let globalAttScheme: (typeof riderSchemes)[number] | null = null;
        for (const s of riderSchemes) {
          if (s.category !== "attendance") continue;
          if (s.client_id === null) globalAttScheme = s;
          else attSchemeByClient.set(s.client_id, s);
        }
        const resolveAttScheme = (clientId: string | null) =>
          (clientId && attSchemeByClient.get(clientId)) || globalAttScheme || null;

        // potongan per detail → kolom dinamis
        const detailIds = (details ?? []).map((d: { id: string }) => d.id);
        const dedByDetail = new Map<string, Record<string, number>>();
        const typeSet = new Set<string>();
        // Dikumpulin sekalian dari query yang sama (bukan query terpisah) buat
        // allocateKasbonByRecipient() di bawah — recipient mana yang kebagian
        // berapa dari kasbon rider ini (lihat lib/kasbon-allocation.ts).
        const kasbonDeductionRows: KasbonDeductionRow[] = [];
        for (let i = 0; i < detailIds.length; i += 200) {
          const chunk = detailIds.slice(i, i + 200);
          const { data: deds, error: e2 } = await sb.from("payroll_deductions")
            .select("detail_id, amount, deduction_types(name, code), kasbon_recipient_id, kasbon_recipients(name, bank_name, account_number, account_holder, no_transfer_needed)")
            .in("detail_id", chunk);
          if (e2) throw e2;
          for (const d of deds ?? []) {
            const name = d.deduction_types?.name ?? "Potongan";
            typeSet.add(name);
            const m = dedByDetail.get(d.detail_id) ?? {};
            m[name] = (m[name] ?? 0) + Number(d.amount || 0);
            dedByDetail.set(d.detail_id, m);
            kasbonDeductionRows.push(d);
          }
        }
        const grossByDetail = new Map((details ?? []).map((d: { id: string; gross_earning: number }) => [d.id, Number(d.gross_earning)]));
        const riderNameByDetail = new Map(
          (details ?? []).map((d: { id: string; rider_name?: string | null }) => [d.id, d.rider_name ?? "(tanpa nama)"]),
        );
        const kasbonAllocations = allocateKasbonByRecipient(grossByDetail, kasbonDeductionRows, riderNameByDetail);

        // Payment hold (lihat payroll_payment_holds di admin.payroll.tsx) —
        // rider yang di-hold gak ikut Bulk Payment reguler, jadi worksheet ini
        // harus nunjukkin itu juga (badge + di-exclude dari GRAND TOTAL),
        // bukan diem-diem nampilin kayak rider normal yang bakal dibayar.
        const holdByDetail = new Map<string, { status: string; reason: string }>();
        {
          const { data: holds, error: eHold } = await sb
            .from("payroll_payment_holds")
            .select("detail_id, status, reason")
            .in("detail_id", detailIds);
          if (eHold && eHold.code !== "42P01") throw eHold;
          for (const h of holds ?? []) holdByDetail.set(h.detail_id, h);
        }

        // detail mentah periode ini (buat drill-down + active dates)
        const [delivs, atts] = await Promise.all([
          // Cuma COMPLETED yang beneran dihitung fee-nya (calcScheme filter isCompleted)
          // — FAILED/PENDING_PICKUP dkk selalu fee=0 di sini, cuma numpuk baris
          // Rp0 di worksheet finance tanpa guna. Tetap kesimpen apa adanya di
          // delivery_records buat BCR Analytics, cuma di-exclude dari view ini.
          // client_id di-filter kalau run ini scoped ke 1 client — kalau enggak,
          // rider yang narik buat >1 client di periode sama ikut kebawa kiriman
          // client LAIN ke drill-down "Kiriman" run ini (lihat RiderDetail).
          fetchAllRows<{ rider_id: string | null; delivery_date: string; distance_km: number | null; weight_kg: number | null; delivery_type: string | null; district: string | null; fee: number }>(
            (c, from, to) => {
              let q = c.from("delivery_records" as any)
                .select("rider_id, delivery_date, distance_km, weight_kg, delivery_type, district, fee")
                .ilike("status", "completed")
                .gte("delivery_date", run.period_start).lte("delivery_date", run.period_end);
              if (run.client_id) q = q.eq("client_id", run.client_id);
              return q.range(from, to);
            }),
          fetchAllRows<{ rider_id: string | null; client_id: string | null; pitstop_name: string | null; log_date: string; clock_in: string | null; clock_out: string | null; duration_minutes: number | null; is_late: boolean; is_absent: boolean; fee: number }>(
            (c, from, to) => {
              let q = (c as any).from("attendance_logs")
                .select("rider_id, client_id, pitstop_name, log_date, clock_in, clock_out, duration_minutes, is_late, is_absent, fee")
                .gte("log_date", run.period_start).lte("log_date", run.period_end);
              if (run.client_id) q = q.eq("client_id", run.client_id);
              return q.range(from, to);
            }),
        ]);

        // Replay base/overtime/insentif-ontime per baris pakai config skema
        // attendance yang berlaku SEKARANG, dikelompokkan per client (cfg beda
        // per client) — cuma buat pecah tampilan Ringkasan, gak menimpa `fee`
        // yang sudah dikomit. Baris tanpa skema attendance yang cocok (mis.
        // client-nya pakai skema delivery/hybrid) dibiarkan base=fee, overtime=0,
        // incentiveAmt=0 — aman, gak recompute apa-apa buat kasus itu.
        const attsByClientKey = new Map<string, typeof atts>();
        for (const a of atts) {
          const key = a.client_id ?? "";
          (attsByClientKey.get(key) ?? attsByClientKey.set(key, []).get(key)!).push(a);
        }
        const compByRowKey = new Map<string, { base: number; overtime: number; incentiveAmt: number; shiftLabel: string | null }>();
        for (const [clientKey, group] of attsByClientKey) {
          const scheme = resolveAttScheme(clientKey || null);
          const cfg = scheme?.params?.config as any;
          const shifts = Array.isArray(cfg?.shifts) ? cfg.shifts : [];
          const logs: AttendanceLogRow[] = group.map((a) => ({
            log_date: a.log_date, clock_in: a.clock_in, duration_minutes: a.duration_minutes, is_late: a.is_late, is_absent: a.is_absent,
          }));
          const comp = cfg ? calcAttendanceComponent(logs, cfg) : group.map(() => ({ daily_base: 0, overtime: 0, incentive: 0 }));
          group.forEach((a, i) => {
            const shift = shifts.length > 0 ? findShiftFor(a.clock_in, shifts) : null;
            compByRowKey.set(`${a.rider_id}|${a.log_date}|${a.clock_in ?? ""}`, {
              base: comp[i].daily_base, overtime: comp[i].overtime, incentiveAmt: comp[i].incentive, shiftLabel: shift?.label ?? null,
            });
          });
        }

        const delivByRider = new Map<string, DelivDetail[]>();
        const datesByRider = new Map<string, Set<string>>();
        for (const r of delivs) {
          if (!r.rider_id) continue;
          (delivByRider.get(r.rider_id) ?? delivByRider.set(r.rider_id, []).get(r.rider_id)!)
            .push({ date: r.delivery_date, km: r.distance_km, kg: r.weight_kg, type: r.delivery_type, district: r.district, fee: Number(r.fee) || 0 });
          const s = datesByRider.get(r.rider_id) ?? new Set<string>();
          s.add(r.delivery_date); datesByRider.set(r.rider_id, s);
        }
        const attByRider = new Map<string, AttDetail[]>();
        for (const a of atts) {
          if (!a.rider_id) continue;
          const fee = Number(a.fee) || 0;
          const comp = compByRowKey.get(`${a.rider_id}|${a.log_date}|${a.clock_in ?? ""}`);
          (attByRider.get(a.rider_id) ?? attByRider.set(a.rider_id, []).get(a.rider_id)!)
            .push({
              date: a.log_date, clockIn: a.clock_in, clockOut: a.clock_out, dur: a.duration_minutes, late: !!a.is_late, absent: !!a.is_absent, fee,
              pitstop: a.pitstop_name, clientId: a.client_id,
              shiftLabel: comp?.shiftLabel ?? null,
              base: comp ? comp.base : fee, overtime: comp?.overtime ?? 0, incentiveAmt: comp?.incentiveAmt ?? 0,
            });
        }

        const built: RiderRow[] = (details ?? []).map((d: {
          id: string; rider_id: string; delivery_count: number; gross_earning: number; net_pay: number; remarks: string | null; incentive?: number | null;
          rider_name?: string | null; rider_employee_id?: string | null; client_name?: string | null;
        }) => ({
          detailId: d.id,
          rider_id: d.rider_id,
          name: d.rider_name ?? "(tanpa nama)",
          employeeId: d.rider_employee_id ?? "",
          clientName: d.client_name ?? "(tanpa client)",
          orderCount: d.delivery_count,
          feeRider: Number(d.gross_earning),
          activeDates: datesByRider.get(d.rider_id)?.size ?? 0,
          ded: dedByDetail.get(d.id) ?? {},
          incentive: Number(d.incentive) || 0,
          total: Number(d.net_pay),
          remarks: d.remarks ?? "",
          deliv: (delivByRider.get(d.rider_id) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
          att: (attByRider.get(d.rider_id) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
          held: holdByDetail.get(d.id)?.status === "held",
          holdReason: holdByDetail.get(d.id)?.status === "held" ? holdByDetail.get(d.id)!.reason : null,
          isKasbonRow: false,
          kasbonNoTransfer: false,
        }));

        // Kasbon ke penerima pihak ke-3 motong net_pay rider, tapi duitnya
        // harus BENERAN ditransfer ke rekening penerima itu — jadi ikut
        // ditampilin sebagai baris sendiri di Ringkasan (bukan cuma raib jadi
        // potongan), dengan GRAND TOTAL yang ikut nambah (net_pay rider SUDAH
        // net dari kasbon, jadi kasbon transfer itu tambahan terpisah, bukan
        // dobel-hitung). Penerima no_transfer_needed (rekening internal
        // perusahaan) tetap ditampilin buat transparansi, tapi TIDAK ikut
        // GRAND TOTAL (gak ada transfer keluar beneran).
        const kasbonRows: RiderRow[] = kasbonAllocations.map((a) => ({
          detailId: `kasbon-${a.recipientId}`,
          rider_id: a.recipientId,
          name: a.recipientName,
          employeeId: "",
          clientName: built[0]?.clientName ?? "",
          orderCount: 0,
          feeRider: 0,
          activeDates: 0,
          ded: {},
          incentive: 0,
          total: a.amount,
          remarks: `Kasbon dari ${a.riderNames.join(", ")}` + (a.noTransferNeeded ? " — rekening internal, gak perlu transfer" : ""),
          deliv: [],
          att: [],
          held: false,
          holdReason: null,
          isKasbonRow: true,
          kasbonNoTransfer: a.noTransferNeeded,
        }));

        setDedTypes([...typeSet].sort());
        setRows([...built, ...kasbonRows].sort((a, b) => b.total - a.total));

        // Rate card: schemes udah di-fetch di atas (riderSchemes) — reuse, gak query lagi.
        setRateCards(riderSchemes.map(describeScheme));
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [runId, run]);

  const saveRemark = async (detailId: string, val: string) => {
    setRows((prev) => prev.map((r) => (r.detailId === detailId ? { ...r, remarks: val } : r)));
    const { error } = await sb.from("payroll_details").update({ remarks: val || null }).eq("id", detailId);
    if (error) toast.error("Gagal simpan remarks: " + error.message);
  };

  // Rider yang di-hold di-exclude dari GRAND TOTAL — dia gak ikut Bulk
  // Payment reguler, jadi total di sini harus nyambung sama yang beneran
  // ditransfer, bukan ikut ngitung duit yang masih ditahan. Baris penerima
  // kasbon dengan rekening internal (kasbonNoTransfer) di-exclude juga —
  // gak ada transfer keluar beneran buat itu.
  const heldRows = useMemo(() => rows.filter((r) => r.held), [rows]);
  const internalKasbonRows = useMemo(() => rows.filter((r) => r.isKasbonRow && r.kasbonNoTransfer), [rows]);
  const t = useMemo(() => rows.filter((r) => !r.held && !r.kasbonNoTransfer).reduce((s, r) => ({
    order: s.order + r.orderCount, fee: s.fee + r.feeRider, total: s.total + r.total,
    ded: dedTypes.reduce((m, ty) => ({ ...m, [ty]: (m[ty] ?? 0) + (r.ded[ty] ?? 0) }), s.ded),
  }), { order: 0, fee: 0, total: 0, ded: {} as Record<string, number> }), [rows, dedTypes]);

  // ---- baris sheet ----
  // Driver Name selalu tampil (identifier baris) — sisanya di-filter sesuai
  // enabledCols (dari export template client, lihat useEffect di atas).
  const summaryRows = (): Cell[][] => {
    const c = enabledCols;
    const header: Cell[] = ["Driver Name"];
    if (c.has("employee_id")) header.push("Employee ID");
    if (c.has("client")) header.push("Client");
    if (c.has("order_count")) header.push("COUNTA of Order");
    if (c.has("fee_rider")) header.push("Fee Rider");
    if (c.has("active_date")) header.push("Active Date");
    if (c.has("deductions")) header.push(...dedTypes);
    if (c.has("total_fee")) header.push("Total Fee Order");
    if (c.has("remarks")) header.push("Remarks");

    const body: Cell[][] = rows.map((r) => {
      const label = r.isKasbonRow
        ? `→ ${r.name} (Penerima Kasbon${r.kasbonNoTransfer ? ", internal" : ""})`
        : r.held ? `${r.name} (DITAHAN)` : r.name;
      const row: Cell[] = [label];
      if (c.has("employee_id")) row.push(r.employeeId);
      if (c.has("client")) row.push(r.clientName);
      if (c.has("order_count")) row.push(r.isKasbonRow ? "" : r.orderCount);
      if (c.has("fee_rider")) row.push(r.isKasbonRow ? "" : r.feeRider);
      if (c.has("active_date")) row.push(r.isKasbonRow ? "" : r.activeDates);
      if (c.has("deductions")) row.push(...dedTypes.map((ty) => (r.isKasbonRow ? "" : (r.ded[ty] ?? 0))));
      if (c.has("total_fee")) row.push(r.total);
      if (c.has("remarks")) row.push(r.held ? `[PEMBAYARAN DITAHAN: ${r.holdReason}] ${r.remarks}` : r.remarks);
      return row;
    });

    const grand: Cell[] = ["GRAND TOTAL"];
    if (c.has("employee_id")) grand.push("");
    if (c.has("client")) grand.push("");
    if (c.has("order_count")) grand.push(t.order);
    if (c.has("fee_rider")) grand.push(t.fee);
    if (c.has("active_date")) grand.push("");
    if (c.has("deductions")) grand.push(...dedTypes.map((ty) => t.ded[ty] ?? 0));
    if (c.has("total_fee")) grand.push(t.total);
    if (c.has("remarks")) grand.push("");

    return [header, ...body, grand];
  };
  const detailRows = (): Cell[][] => {
    const header: Cell[] = ["Driver Name", "Kode Mitra", "Client", "Tanggal", "Jenis", "Jarak (km)", "Berat (kg)", "District", "OTP / Status", "Fee"];
    const out: Cell[][] = [header];
    // Baris penerima kasbon gak punya kiriman/absensi mentah buat di-itemize
    // di sheet Detail — cukup muncul di Ringkasan (summaryRows).
    for (const r of rows.filter((row) => !row.isKasbonRow)) {
      for (const d of r.deliv) out.push([r.name, r.employeeId, r.clientName, d.date, "Kiriman", d.km ?? "", d.kg ?? "", d.district ?? "", d.type ?? "", d.fee]);
      for (const a of r.att) out.push([r.name, r.employeeId, r.clientName, a.date, "Absensi", "", "", "", otpLabel(a), a.fee]);
      const sub = r.deliv.reduce((s, d) => s + d.fee, 0) + r.att.reduce((s, a) => s + a.fee, 0);
      out.push(["", "", "", "", "", "", "", "", `Subtotal ${r.name}`, sub]);
    }
    return out;
  };

  // Run yang murni attendance (semua rider tanpa data kiriman sama sekali) —
  // pakai layout Detail/Ringkasan yang beda (lihat lib/attendance-worksheet-export.ts),
  // mengikuti format sheet referensi ops (Pitstop Name, Shift, breakdown Total
  // Fee vs Incentive Ontime terpisah). Run delivery/hybrid tetap pakai
  // detailRows/summaryRows generik di atas — TIDAK diubah.
  const isAttendanceOnly = isAttendanceOnlyRun(rows);

  const exportExcel = () => {
    const sheets = [
      { name: "Rate Card (PKS)", rows: rateCards.length ? rateCardsToRows(rateCards) : [["(tidak ada skema rider untuk client di run ini)"]] },
      { name: "Detail", rows: isAttendanceOnly ? attendanceDetailRows(rows) : detailRows() },
      { name: "Ringkasan", rows: isAttendanceOnly ? attendanceSummaryRows(rows, run) : summaryRows() },
    ];
    downloadXLS(`worksheet-${run?.name ?? runId}`, sheets);
  };
  const exportSummaryCSV = () =>
    downloadCSV(`ringkasan-${run?.name ?? runId}.csv`, toCSV(isAttendanceOnly ? attendanceSummaryRows(rows, run) : summaryRows()));
  const exportDetailCSV = () =>
    downloadCSV(`detail-${run?.name ?? runId}.csv`, toCSV(isAttendanceOnly ? attendanceDetailRows(rows) : detailRows()));

  const { pageSize, setPageSize, page, setPage, totalPages, paged, from, to, total } = usePagination(rows, 20);

  // Jumlah kolom yang beneran tampil di tabel on-screen — dipakai buat
  // colSpan baris kosong/drilldown, biar gak mismatch pas kolom di-toggle.
  const visibleColCount =
    1 + // Driver Name, selalu ada
    (enabledCols.has("client") ? 1 : 0) +
    (enabledCols.has("order_count") ? 1 : 0) +
    (enabledCols.has("fee_rider") ? 1 : 0) +
    (enabledCols.has("active_date") ? 1 : 0) +
    (enabledCols.has("deductions") ? dedTypes.length : 0) +
    (enabledCols.has("total_fee") ? 1 : 0) +
    (enabledCols.has("remarks") ? 1 : 0);

  if (loading) return <Loader2 className="w-4 h-4 animate-spin" />;

  return (
    <>
      {/* Rate card / PKS */}
      <div className="admin-glass-panel rounded-xl border border-border bg-card mb-4 overflow-hidden">
        <button onClick={() => setShowRates((v) => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40">
          <FileSpreadsheet className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">{tr("financeWs.rateCardHeader")} ({rateCards.length} {tr("financeWs.schemesUnit")})</span>
          <ChevronRight className={`w-4 h-4 ml-auto transition-transform ${showRates ? "rotate-90" : ""}`} />
        </button>
        {showRates && (
          <div className="px-4 pb-4 pt-1 grid gap-3 md:grid-cols-2">
            {rateCards.length === 0 ? (
              <p className="text-xs text-muted-foreground">{tr("financeWs.noRiderSchemes")}</p>
            ) : rateCards.map((c, i) => (
              <div key={i} className="rounded-lg border border-border overflow-hidden">
                <div className="admin-glass-strip px-3 py-2 bg-muted flex items-center gap-2">
                  <span className="text-[13px] font-semibold truncate">{c.schemeName}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground border-2 border-border-strong ml-auto flex-shrink-0">{c.calcLabel}</span>
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {c.sections.map((sec, si) => (
                      <Fragment key={si}>
                        {sec.title && <tr><td colSpan={4} className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/30">{sec.title}</td></tr>}
                        {sec.rows.map((r, ri) => (
                          <tr key={`${si}-${ri}`} className="border-t border-border">
                            <td className="px-3 py-1.5">{r.variable}</td>
                            <td className="px-2 py-1.5 text-right font-medium tabular-nums whitespace-nowrap">{r.rate}</td>
                            <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{r.unit}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{r.remarks}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Export — konsolidasi ke 1 dropdown biar gak numpuk 3 tombol sejajar */}
      <div className="flex flex-wrap justify-end items-center gap-2 mb-3">
        {rows.length > 0 && <PageSizeSelect pageSize={pageSize} setPageSize={setPageSize} />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button disabled={!rows.length}
              className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm disabled:opacity-50">
              <Download className="w-4 h-4" /> {tr("financeWs.download")} <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem onClick={exportExcel} className="flex-col items-start gap-0.5 py-2">
              <span className="flex items-center gap-2 font-medium"><FileSpreadsheet className="w-4 h-4" /> {tr("financeWs.excelThreeSheets")}</span>
              <span className="text-xs text-muted-foreground pl-6">{tr("financeWs.excelThreeSheetsDesc")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportSummaryCSV} className="flex-col items-start gap-0.5 py-2">
              <span className="flex items-center gap-2 font-medium"><Download className="w-4 h-4" /> {tr("financeWs.csvSummary")}</span>
              <span className="text-xs text-muted-foreground pl-6">{tr("financeWs.csvSummaryDesc")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportDetailCSV} className="flex-col items-start gap-0.5 py-2">
              <span className="flex items-center gap-2 font-medium"><Download className="w-4 h-4" /> {tr("financeWs.csvDetail")}</span>
              <span className="text-xs text-muted-foreground pl-6">{tr("financeWs.csvDetailDesc")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Ringkasan + drill-down */}
      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-muted text-left">
            <tr>
              <th className="p-2 sticky left-0 bg-muted">{tr("financeWs.driverName")}</th>
              {enabledCols.has("client") && <th className="px-3">{tr("financeWs.client")}</th>}
              {enabledCols.has("order_count") && <th className="text-right px-3">{tr("financeWs.order")}</th>}
              {enabledCols.has("fee_rider") && <th className="text-right px-3">{tr("financeWs.feeRiderLabel")}</th>}
              {enabledCols.has("active_date") && <th className="text-right px-3">{tr("financeWs.active")}</th>}
              {enabledCols.has("deductions") && dedTypes.map((ty) => <th key={ty} className="text-right px-3">{ty}</th>)}
              {enabledCols.has("total_fee") && <th className="text-right px-3">{tr("financeWs.totalFee")}</th>}
              {enabledCols.has("remarks") && <th className="px-3 min-w-[180px]">{tr("financeWs.remarks")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={visibleColCount} className="p-6 text-center text-muted-foreground">{tr("financeWs.noDataEmptyState")}</td></tr> :
              paged.map((r) => (
                <Fragment key={r.detailId}>
                  <tr className={`border-t border-border ${r.held ? "bg-destructive/5" : r.isKasbonRow ? "bg-secondary" : ""}`}>
                    <td className="p-2 sticky left-0 bg-background">
                      <button onClick={() => !r.isKasbonRow && setExpanded(expanded === r.detailId ? null : r.detailId)} className={`flex items-center gap-1.5 text-left ${r.isKasbonRow ? "cursor-default" : "hover:text-primary"}`}>
                        {!r.isKasbonRow && <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${expanded === r.detailId ? "rotate-90" : ""}`} />}
                        <span>
                          <span className="font-medium flex items-center gap-1.5">
                            {r.isKasbonRow ? `→ ${r.name}` : r.name}
                            {r.held && (
                              <span title={r.holdReason ?? ""} className="rounded border-2 border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-destructive text-destructive-foreground">
                                {tr("financeWs.heldBadge")}
                              </span>
                            )}
                            {r.isKasbonRow && (
                              <span className="rounded border-2 border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-primary text-primary-foreground">
                                {r.kasbonNoTransfer ? tr("financeWs.kasbonInternalBadge") : tr("financeWs.kasbonTransferBadge")}
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground block">{r.isKasbonRow ? r.remarks : r.employeeId}</span>
                        </span>
                      </button>
                    </td>
                    {enabledCols.has("client") && <td className="px-3 text-[13px] text-muted-foreground">{r.clientName}</td>}
                    {enabledCols.has("order_count") && <td className="text-right px-3 tabular-nums">{r.isKasbonRow ? "—" : r.orderCount}</td>}
                    {enabledCols.has("fee_rider") && <td className="text-right px-3 tabular-nums">{r.isKasbonRow ? "—" : rp(r.feeRider)}</td>}
                    {enabledCols.has("active_date") && <td className="text-right px-3 tabular-nums">{r.isKasbonRow ? "—" : r.activeDates}</td>}
                    {enabledCols.has("deductions") && dedTypes.map((ty) => (
                      <td key={ty} className="text-right px-3 tabular-nums text-destructive">{r.isKasbonRow ? "—" : r.ded[ty] ? rp(r.ded[ty]) : "—"}</td>
                    ))}
                    {enabledCols.has("total_fee") && <td className="text-right px-3 font-semibold tabular-nums">{rp(r.total)}</td>}
                    {enabledCols.has("remarks") && (
                      <td className="px-2">
                        {r.isKasbonRow ? (
                          <span className="text-xs text-muted-foreground">{r.remarks}</span>
                        ) : (
                          <input defaultValue={r.remarks} onBlur={(e) => { if (e.target.value !== r.remarks) saveRemark(r.detailId, e.target.value); }}
                            placeholder={tr("financeWs.remarksPlaceholder")} className="w-full min-w-[160px] rounded border border-border bg-background px-2 py-1 text-xs" />
                        )}
                      </td>
                    )}
                  </tr>
                  {expanded === r.detailId && (
                    <tr className="bg-muted/30">
                      <td colSpan={visibleColCount} className="px-4 py-3">
                        <RiderDetail r={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-muted font-semibold">
              <tr>
                <td className="p-2 sticky left-0 bg-muted">{tr("financeWs.grandTotal")}</td>
                {enabledCols.has("client") && <td></td>}
                {enabledCols.has("order_count") && <td className="text-right px-3 tabular-nums">{t.order}</td>}
                {enabledCols.has("fee_rider") && <td className="text-right px-3 tabular-nums">{rp(t.fee)}</td>}
                {enabledCols.has("active_date") && <td className="text-right px-3">—</td>}
                {enabledCols.has("deductions") && dedTypes.map((ty) => <td key={ty} className="text-right px-3 tabular-nums">{rp(t.ded[ty] ?? 0)}</td>)}
                {enabledCols.has("total_fee") && <td className="text-right px-3 tabular-nums">{rp(t.total)}</td>}
                {enabledCols.has("remarks") && <td></td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.length > 0 && <PaginationBar page={page} totalPages={totalPages} setPage={setPage} from={from} to={to} total={total} />}
      <p className="text-xs text-muted-foreground mt-2">
        {tr("financeWs.helpText")}
      </p>
      {heldRows.length > 0 && (
        <p className="text-xs text-destructive mt-1">
          {heldRows.length} {tr("financeWs.heldRidersPrefix")} ({rp(heldRows.reduce((s, r) => s + r.total, 0))}) {tr("financeWs.heldRidersSuffix")}
        </p>
      )}
      {rows.some((r) => r.isKasbonRow && !r.kasbonNoTransfer) && (
        <p className="text-xs text-muted-foreground mt-1">
          {tr("financeWs.kasbonTransferNote")}
        </p>
      )}
      {internalKasbonRows.length > 0 && (
        <p className="text-xs text-muted-foreground mt-1">
          {internalKasbonRows.length} {tr("financeWs.internalKasbonPrefix")} ({rp(internalKasbonRows.reduce((s, r) => s + r.total, 0))}) {tr("financeWs.internalKasbonSuffix")}
        </p>
      )}
    </>
  );
}

function RiderDetail({ r }: { r: RiderRow }) {
  const { t } = useT();
  const delivSum = r.deliv.reduce((s, d) => s + d.fee, 0);
  const attSum = r.att.reduce((s, a) => s + a.fee, 0);
  return (
    <div className="space-y-3">
      {r.deliv.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{t("financeWs.deliveriesHeading")} ({r.deliv.length})</div>
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-xs whitespace-nowrap bg-card">
              <thead className="bg-muted text-left"><tr><th className="px-3 py-1.5">{t("financeWs.date")}</th><th className="text-right px-3">{t("financeWs.distanceKm")}</th><th className="text-right px-3">{t("financeWs.weightKg")}</th><th className="px-3">{t("financeWs.district")}</th><th className="px-3">{t("financeWs.type")}</th><th className="text-right px-3">{t("financeWs.fee")}</th></tr></thead>
              <tbody>
                {r.deliv.map((d, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-1.5">{d.date}</td>
                    <td className="text-right px-3 tabular-nums">{d.km ?? "—"}</td>
                    <td className="text-right px-3 tabular-nums">{d.kg ?? "—"}</td>
                    <td className="px-3">{d.district ?? "—"}</td>
                    <td className="px-3">{d.type ?? "—"}</td>
                    <td className="text-right px-3 tabular-nums">{rp(d.fee)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border-strong font-medium"><td className="px-3 py-1.5" colSpan={5}>{t("financeWs.subtotalDeliveries")}</td><td className="text-right px-3 tabular-nums">{rp(delivSum)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      {r.att.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{t("financeWs.attendanceHeading")} ({r.att.length})</div>
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-xs whitespace-nowrap bg-card">
              <thead className="bg-muted text-left"><tr><th className="px-3 py-1.5">{t("financeWs.date")}</th><th className="px-3">{t("financeWs.clockIn")}</th><th className="px-3">{t("financeWs.clockOut")}</th><th className="px-3">{t("financeWs.duration")}</th><th className="px-3">{t("financeWs.otp")}</th><th className="text-right px-3">{t("financeWs.fee")}</th></tr></thead>
              <tbody>
                {r.att.map((a, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-1.5">{a.date}</td>
                    <td className="px-3">{a.clockIn ?? "—"}</td>
                    <td className="px-3">{a.clockOut ?? "—"}</td>
                    <td className="px-3">{durLabel(a.dur)}</td>
                    <td className="px-3">{otpLabel(a)}</td>
                    <td className="text-right px-3 tabular-nums">{rp(a.fee)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border-strong font-medium"><td className="px-3 py-1.5" colSpan={5}>{t("financeWs.subtotalAttendance")}</td><td className="text-right px-3 tabular-nums">{rp(attSum)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Σ {t("financeWs.deliveriesShort")} {rp(delivSum)} + {t("financeWs.attendanceShort")} {rp(attSum)} = {t("financeWs.feeRiderLabel")} {rp(r.feeRider)} → {t("financeWs.minusDeductions")} → {t("financeWs.totalLabel")} {rp(r.total)}.
      </p>
    </div>
  );
}
