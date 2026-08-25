import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { ClientCombobox } from "@/components/client-combobox";
import { DatePicker } from "@/components/date-picker";

// Search params opsional — diisi otomatis kalau dibuka dari link "Cek Data"
// di Payroll Run (bawa periode run aktif), biar gak perlu pilih ulang manual.
// Cuma dipakai tab Delivery (link itu selalu buka ke situ).
interface DataCheckSearch {
  from?: string;
  to?: string;
}

export const Route = createFileRoute("/admin/data-check")({
  component: DataCheckPage,
  validateSearch: (search: Record<string, unknown>): DataCheckSearch => ({
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
  }),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Client = { id: string; name: string };

function useClients() {
  const [clients, setClients] = useState<Client[]>([]);
  useEffect(() => {
    supabase.from("clients").select("id, name").order("name").then(({ data }) => setClients(data ?? []));
  }, []);
  return clients;
}

function DataCheckPage() {
  const { t } = useT();
  const [tab, setTab] = useState<"delivery" | "attendance">("delivery");
  return (
    <AdminLayout title={t("dataCheck.title")} subtitle={t("dataCheck.subtitle")}>
      <div className="inline-flex flex-wrap border-2 border-border-strong rounded-md bg-card shadow-[4px_4px_0_0_var(--color-border-strong)] w-fit mb-5 overflow-hidden">
        {(["delivery", "attendance"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-1.5 text-sm font-bold border-l-2 border-border-strong first:border-l-0 transition-colors ${tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            {k === "delivery" ? "Delivery" : "Attendance"}
          </button>
        ))}
      </div>
      {tab === "delivery" ? <DeliveryCheck /> : <AttendanceCheck />}
    </AdminLayout>
  );
}

type DeliveryRow = {
  driver_code: string | null; delivery_date: string; status: string | null;
  delivery_type: string | null; client_id: string | null; dash_delivery_id: string | null;
  provider_order_id: string | null; distance_km: number | null; weight_kg: number | null;
  riders?: { full_name: string | null } | null;
};

function DeliveryCheck() {
  const search = Route.useSearch();
  const clients = useClients();
  const [clientId, setClientId] = useState("");
  const [q, setQ] = useState(""); // cari kode/nama rider
  const [from, setFrom] = useState(search.from ?? "");
  const [to, setTo] = useState(search.to ?? "");
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [total, setTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Server-side pagination beneran — cuma tarik 1 halaman (pageSize baris)
  // dari database per request, BUKAN tarik semua baris dulu baru dipotong di
  // browser. Cek Data ini murni browsing data mentah (gak butuh total/agregat
  // dari SEMUA baris kayak Reports/Payroll Run), jadi aman di-page di server —
  // reload jadi jauh lebih cepat buat client yang datanya ribuan baris.
  const fetchPage = async (pageNum: number) => {
    setLoading(true); setRan(true);
    try {
      const baseFilter = (query: any) => {
        let q2 = query;
        if (clientId) q2 = q2.eq("client_id", clientId);
        if (from) q2 = q2.gte("delivery_date", from);
        if (to) q2 = q2.lte("delivery_date", to);
        if (q.trim()) q2 = q2.ilike("driver_code", `%${q.trim()}%`);
        return q2;
      };

      const start = (pageNum - 1) * pageSize;
      const [pageRes, completedRes] = await Promise.all([
        baseFilter(
          sb.from("delivery_records")
            .select("driver_code, delivery_date, status, delivery_type, client_id, dash_delivery_id, provider_order_id, distance_km, weight_kg, riders(full_name)", { count: "exact" })
            .order("delivery_date", { ascending: false }),
        ).range(start, start + pageSize - 1),
        baseFilter(sb.from("delivery_records").select("id", { count: "exact", head: true })).eq("status", "completed"),
      ]);
      if (pageRes.error) throw pageRes.error;
      if (completedRes.error) throw completedRes.error;

      setRows((pageRes.data ?? []) as DeliveryRow[]);
      setTotal(pageRes.count ?? 0);
      setCompleted(completedRes.count ?? 0);
      setPage(pageNum);
      if (pageNum === 1 && (pageRes.count ?? 0) === 0) toast.message("Tidak ada baris cocok di database untuk filter ini.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-jalanin pencarian kalau datang dari link Payroll Run yang udah
  // bawa periode (from/to) — user gak perlu pilih ulang & klik "Cari" manual.
  useEffect(() => {
    if (search.from && search.to) fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ganti halaman / page size — refetch dari server, bukan slice array lokal.
  useEffect(() => {
    if (ran) fetchPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  const clientName = (id: string | null) => (id ? clients.find((c) => c.id === id)?.name ?? "(client tak dikenal)" : "(client KOSONG)");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = Math.min(page * pageSize, total);

  return (
    <>
      <div className="rounded-xl border-2 border-border-strong bg-card shadow-[5px_5px_0_0_var(--color-border-strong)] p-5 mb-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground">Client <span className="font-normal">(opsional)</span></label>
          <ClientCombobox
            value={clientId}
            onChange={setClientId}
            placeholder="— semua client —"
            className="w-full text-sm py-2"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground">Kode Rider <span className="font-normal">(opsional, mis. MTR0006460)</span></label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ketik sebagian kode rider…"
            className="w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground">Dari Tanggal <span className="font-normal">(opsional)</span></label>
          <DatePicker value={from} onChange={setFrom} className="w-full" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground">Sampai Tanggal <span className="font-normal">(opsional)</span></label>
          <DatePicker value={to} onChange={setTo} className="w-full" />
        </div>
        <div className="md:col-span-2">
          <button onClick={() => fetchPage(1)} disabled={loading}
            className="inline-flex items-center gap-2 rounded-md border-2 border-border-strong bg-primary text-primary-foreground px-4 py-2 text-sm font-bold shadow-[3px_3px_0_0_var(--color-border-strong)] disabled:opacity-50 disabled:shadow-none hover:brightness-105 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-[filter,transform,box-shadow]">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} {loading ? "Mencari…" : "Cari di Database"}
          </button>
        </div>
      </div>

      {ran && !loading && (
        <p className="text-sm text-muted-foreground mb-3">
          Ketemu <b className="text-foreground">{total}</b> baris tersimpan · <b className="text-foreground">{completed}</b> COMPLETED.
          {total === 0 && " → berarti data ini MEMANG belum ada di database (bukan salah hitung)."}
        </p>
      )}

      {total > 0 && (
        <>
          <div className="flex justify-end mb-2">
            <PageSizeSelect pageSize={pageSize} setPageSize={setPageSize} />
          </div>
          <div className="rounded-xl border-2 border-border-strong shadow-[5px_5px_0_0_var(--color-border-strong)] overflow-x-auto relative">
            {loading && (
              <div className="absolute inset-0 bg-background/60 grid place-items-center z-10">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="p-2">Kode Rider</th><th className="px-3">Nama</th><th className="px-3">Tgl Delivery</th>
                  <th className="px-3">Status</th><th className="px-3">Delivery Type</th><th className="px-3">Client</th>
                  <th className="px-3">Dash ID</th><th className="px-3 text-right">Jarak</th><th className="px-3 text-right">Berat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2 font-mono text-xs">{r.driver_code ?? "—"}</td>
                    <td className="px-3">{r.riders?.full_name ?? "—"}</td>
                    <td className="px-3 tabular-nums">{r.delivery_date}</td>
                    <td className="px-3">{r.status ?? "—"}</td>
                    <td className="px-3">{r.delivery_type ?? "—"}</td>
                    <td className={"px-3 " + (r.client_id ? "" : "text-destructive font-medium")}>{clientName(r.client_id)}</td>
                    <td className="px-3 font-mono text-xs">{r.dash_delivery_id ?? "—"}</td>
                    <td className="px-3 text-right tabular-nums">{r.distance_km ?? "—"}</td>
                    <td className="px-3 text-right tabular-nums">{r.weight_kg ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationBar
            page={page} totalPages={totalPages}
            setPage={(fn) => fetchPage(fn(page))}
            from={rangeFrom} to={rangeTo} total={total}
          />
        </>
      )}
    </>
  );
}

type AttendanceRow = {
  driver_code: string | null; log_date: string; clock_in: string | null; clock_out: string | null;
  duration_minutes: number | null; is_late: boolean | null; is_absent: boolean | null; fee: number | null;
  client_id: string | null; pitstop_name: string | null;
  riders?: { full_name: string | null } | null;
};

// Sama persis polanya dengan DeliveryCheck di atas — query attendance_logs
// bukannya delivery_records. Sebelum ini gak ada cara buat browsing raw data
// absensi langsung dari DB; satu-satunya cara liat attendance adalah expand
// baris rider di Reports > Per Rider (Finance), yang cuma muncul SETELAH
// payroll run di-generate untuk periode itu.
function AttendanceCheck() {
  const clients = useClients();
  const [clientId, setClientId] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [total, setTotal] = useState(0);
  const [absent, setAbsent] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const fetchPage = async (pageNum: number) => {
    setLoading(true); setRan(true);
    try {
      const baseFilter = (query: any) => {
        let q2 = query;
        if (clientId) q2 = q2.eq("client_id", clientId);
        if (from) q2 = q2.gte("log_date", from);
        if (to) q2 = q2.lte("log_date", to);
        if (q.trim()) q2 = q2.ilike("driver_code", `%${q.trim()}%`);
        return q2;
      };

      const start = (pageNum - 1) * pageSize;
      const [pageRes, absentRes] = await Promise.all([
        baseFilter(
          sb.from("attendance_logs")
            .select("driver_code, log_date, clock_in, clock_out, duration_minutes, is_late, is_absent, fee, client_id, pitstop_name, riders(full_name)", { count: "exact" })
            .order("log_date", { ascending: false }),
        ).range(start, start + pageSize - 1),
        baseFilter(sb.from("attendance_logs").select("id", { count: "exact", head: true })).eq("is_absent", true),
      ]);
      if (pageRes.error) throw pageRes.error;
      if (absentRes.error) throw absentRes.error;

      setRows((pageRes.data ?? []) as AttendanceRow[]);
      setTotal(pageRes.count ?? 0);
      setAbsent(absentRes.count ?? 0);
      setPage(pageNum);
      if (pageNum === 1 && (pageRes.count ?? 0) === 0) toast.message("Tidak ada baris cocok di database untuk filter ini.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ran) fetchPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  const clientName = (id: string | null) => (id ? clients.find((c) => c.id === id)?.name ?? "(client tak dikenal)" : "(client KOSONG)");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = Math.min(page * pageSize, total);

  return (
    <>
      <div className="rounded-xl border-2 border-border-strong bg-card shadow-[5px_5px_0_0_var(--color-border-strong)] p-5 mb-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground">Client <span className="font-normal">(opsional)</span></label>
          <ClientCombobox
            value={clientId}
            onChange={setClientId}
            placeholder="— semua client —"
            className="w-full text-sm py-2"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground">Kode Rider <span className="font-normal">(opsional, mis. MTR0006460)</span></label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ketik sebagian kode rider…"
            className="w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground">Dari Tanggal <span className="font-normal">(opsional)</span></label>
          <DatePicker value={from} onChange={setFrom} className="w-full" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground">Sampai Tanggal <span className="font-normal">(opsional)</span></label>
          <DatePicker value={to} onChange={setTo} className="w-full" />
        </div>
        <div className="md:col-span-2">
          <button onClick={() => fetchPage(1)} disabled={loading}
            className="inline-flex items-center gap-2 rounded-md border-2 border-border-strong bg-primary text-primary-foreground px-4 py-2 text-sm font-bold shadow-[3px_3px_0_0_var(--color-border-strong)] disabled:opacity-50 disabled:shadow-none hover:brightness-105 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-[filter,transform,box-shadow]">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} {loading ? "Mencari…" : "Cari di Database"}
          </button>
        </div>
      </div>

      {ran && !loading && (
        <p className="text-sm text-muted-foreground mb-3">
          Ketemu <b className="text-foreground">{total}</b> baris tersimpan · <b className="text-foreground">{absent}</b> ABSEN.
          {total === 0 && " → berarti data ini MEMANG belum ada di database (bukan salah hitung)."}
        </p>
      )}

      {total > 0 && (
        <>
          <div className="flex justify-end mb-2">
            <PageSizeSelect pageSize={pageSize} setPageSize={setPageSize} />
          </div>
          <div className="rounded-xl border-2 border-border-strong shadow-[5px_5px_0_0_var(--color-border-strong)] overflow-x-auto relative">
            {loading && (
              <div className="absolute inset-0 bg-background/60 grid place-items-center z-10">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="p-2">Kode Rider</th><th className="px-3">Nama</th><th className="px-3">Tanggal</th>
                  <th className="px-3">Clock In</th><th className="px-3">Clock Out</th><th className="px-3 text-right">Durasi (menit)</th>
                  <th className="px-3">Telat</th><th className="px-3">Absen</th><th className="px-3 text-right">Fee</th>
                  <th className="px-3">Client</th><th className="px-3">Pitstop</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2 font-mono text-xs">{r.driver_code ?? "—"}</td>
                    <td className="px-3">{r.riders?.full_name ?? "—"}</td>
                    <td className="px-3 tabular-nums">{r.log_date}</td>
                    <td className="px-3 tabular-nums">{r.clock_in ?? "—"}</td>
                    <td className="px-3 tabular-nums">{r.clock_out ?? "—"}</td>
                    <td className="px-3 text-right tabular-nums">{r.duration_minutes ?? "—"}</td>
                    <td className={"px-3 " + (r.is_late ? "text-warning font-medium" : "")}>{r.is_late ? "Ya" : "—"}</td>
                    <td className={"px-3 " + (r.is_absent ? "text-destructive font-medium" : "")}>{r.is_absent ? "Ya" : "—"}</td>
                    <td className="px-3 text-right tabular-nums">{r.fee != null ? `Rp${Number(r.fee).toLocaleString("id-ID")}` : "—"}</td>
                    <td className={"px-3 " + (r.client_id ? "" : "text-destructive font-medium")}>{clientName(r.client_id)}</td>
                    <td className="px-3">{r.pitstop_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationBar
            page={page} totalPages={totalPages}
            setPage={(fn) => fetchPage(fn(page))}
            from={rangeFrom} to={rangeTo} total={total}
          />
        </>
      )}
    </>
  );
}
