import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { ClientCombobox } from "@/components/client-combobox";

// Search params opsional — diisi otomatis kalau dibuka dari link "Cek Data"
// di Payroll Run (bawa periode run aktif), biar gak perlu pilih ulang manual.
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
type Row = {
  driver_code: string | null; delivery_date: string; status: string | null;
  delivery_type: string | null; client_id: string | null; dash_delivery_id: string | null;
  provider_order_id: string | null; distance_km: number | null; weight_kg: number | null;
  riders?: { full_name: string | null } | null;
};

function DataCheckPage() {
  const { t } = useT();
  const search = Route.useSearch();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [q, setQ] = useState(""); // cari kode/nama rider
  const [from, setFrom] = useState(search.from ?? "");
  const [to, setTo] = useState(search.to ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [total, setTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    supabase.from("clients").select("id, name").order("name").then(({ data }) => setClients(data ?? []));
  }, []);

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

      setRows((pageRes.data ?? []) as Row[]);
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
    <AdminLayout title={t("dataCheck.title")} subtitle={t("dataCheck.subtitle")}>
      <div className="rounded-lg border border-border bg-card p-5 mb-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
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
            className="w-full rounded-md border border-border bg-background px-3 py-2" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground">Dari Tanggal <span className="font-normal">(opsional)</span></label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground">Sampai Tanggal <span className="font-normal">(opsional)</span></label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2" />
        </div>
        <div className="md:col-span-2">
          <button onClick={() => fetchPage(1)} disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
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
          <div className="rounded-lg border border-border overflow-x-auto relative">
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
    </AdminLayout>
  );
}
