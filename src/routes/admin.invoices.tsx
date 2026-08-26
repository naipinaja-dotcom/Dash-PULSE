import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";
import { toCSV, downloadCSV } from "@/lib/csv";
import { confirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import { Download, Loader2, Trash2, CheckCircle2, Printer, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { ClientCombobox } from "@/components/client-combobox";

export const Route = createFileRoute("/admin/invoices")({ component: InvoicesPage });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Invoice = {
  id: string; client_id: string; invoice_date: string; period_start: string | null; period_end: string | null;
  calculation_type: string | null; scheme_name: string | null; base_amount: number; surcharge_amount: number;
  total_amount: number; status: string; created_at: string; invoice_no: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail_breakdown: any | null;
};
type Client = { id: string; name: string; address: string | null; contact_person: string | null; phone: string | null };

function InvoicesPage() {
  const { t } = useT();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientFilter, setClientFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [printInv, setPrintInv] = useState<Invoice | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: inv, error }, { data: cl }] = await Promise.all([
      sb.from("invoice_details").select("*").order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name, address, contact_person, phone").order("name"),
    ]);
    if (error) toast.error(error.message);
    setInvoices(inv ?? []);
    setClients(cl ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? "(client tak dikenal)";

  const filtered = invoices.filter((i) => !clientFilter || i.client_id === clientFilter);
  const { pageSize, setPageSize, page, setPage, totalPages, paged, from, to, total } = usePagination(filtered, 20);

  const finalize = async (i: Invoice) => {
    setBusyId(i.id);
    const { error } = await sb.from("invoice_details").update({ status: "finalized" }).eq("id", i.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Invoice dikunci sebagai final");
    load();
  };

  const remove = async (i: Invoice) => {
    if (!(await confirmDialog({ title: "Hapus invoice?", description: `Invoice ${clientName(i.client_id)} periode ${i.period_start ?? "?"} → ${i.period_end ?? "?"} akan dihapus permanen.`, confirmText: "Hapus", danger: true }))) return;
    setBusyId(i.id);
    const { error } = await sb.from("invoice_details").delete().eq("id", i.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Invoice dihapus");
    load();
  };

  const exportCSV = () => {
    const header = ["No. Invoice", "Client", "Periode Dari", "Periode Sampai", "Tipe Skema", "Subtotal", "Tambahan", "Total", "Status", "Tanggal Invoice"];
    const data = filtered.map((i) => [
      i.invoice_no ?? "", clientName(i.client_id), i.period_start ?? "", i.period_end ?? "", i.scheme_name ?? i.calculation_type ?? "",
      i.base_amount, i.surcharge_amount, i.total_amount, i.status, i.invoice_date,
    ]);
    downloadCSV("invoices.csv", toCSV([header, ...data]));
  };

  const grandTotal = filtered.reduce((s, i) => s + Number(i.total_amount), 0);

  return (
    <AdminLayout title={t("invoices.title")} subtitle={t("invoices.subtitle")}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <ClientCombobox
          value={clientFilter}
          onChange={setClientFilter}
          placeholder="— semua client —"
          className="min-w-[220px] text-sm py-2"
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
        />
        <div className="flex items-center gap-2">
          {filtered.length > 0 && <PageSizeSelect pageSize={pageSize} setPageSize={setPageSize} />}
          <button onClick={exportCSV} disabled={!filtered.length}
            className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm disabled:opacity-50">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-muted text-left">
            <tr>
              <th className="p-3">No. Invoice</th>
              <th className="px-3">Client</th>
              <th className="px-3">Periode</th>
              <th className="px-3">Tipe Skema</th>
              <th className="px-3 text-right">Subtotal</th>
              <th className="px-3 text-right">Tambahan</th>
              <th className="px-3 text-right">Total</th>
              <th className="px-3">Status</th>
              <th className="px-3 text-right pr-3">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={9} className="p-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></td></tr>
            : filtered.length === 0 ? <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Belum ada invoice — commit dari halaman Hitung Fee dengan skema Client.</td></tr>
            : paged.map((i) => (
              <tr key={i.id} className="border-t border-border">
                <td className="p-3 font-mono text-xs">{i.invoice_no ?? "—"}</td>
                <td className="p-3 font-medium">{clientName(i.client_id)}</td>
                <td className="px-3 tabular-nums">{i.period_start ?? "—"} → {i.period_end ?? "—"}</td>
                <td className="px-3">{i.scheme_name ?? i.calculation_type ?? "—"}</td>
                <td className="px-3 text-right tabular-nums">Rp{Number(i.base_amount).toLocaleString("id-ID")}</td>
                <td className="px-3 text-right tabular-nums">Rp{Number(i.surcharge_amount).toLocaleString("id-ID")}</td>
                <td className="px-3 text-right font-semibold tabular-nums">Rp{Number(i.total_amount).toLocaleString("id-ID")}</td>
                <td className="px-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${i.status === "finalized" ? "border-2 border-border-strong bg-success text-success-foreground" : "bg-muted text-muted-foreground"}`}>
                    {i.status === "finalized" ? "Final" : "Draft"}
                  </span>
                </td>
                <td className="px-3 text-right pr-3">
                  <button onClick={() => setPrintInv(i)} title="Lihat / Cetak invoice"
                    className="p-1.5 hover:bg-primary/10 text-primary rounded mr-1">
                    <Printer className="w-4 h-4" />
                  </button>
                  {i.status !== "finalized" && (
                    <button onClick={() => finalize(i)} disabled={busyId === i.id} title="Kunci sebagai final"
                      className="p-1.5 text-success hover:bg-success hover:text-success-foreground rounded disabled:opacity-50 mr-1">
                      {busyId === i.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    </button>
                  )}
                  <button onClick={() => remove(i)} disabled={busyId === i.id} title="Hapus"
                    className="p-1.5 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded disabled:opacity-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="bg-muted font-semibold">
              <tr>
                <td className="p-3" colSpan={6}>GRAND TOTAL</td>
                <td className="px-3 text-right tabular-nums">Rp{grandTotal.toLocaleString("id-ID")}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {filtered.length > 0 && <PaginationBar page={page} totalPages={totalPages} setPage={setPage} from={from} to={to} total={total} />}
      <p className="text-xs text-muted-foreground mt-2">
        Draft masih bisa dihapus/diubah dari Hitung Fee (commit ulang). "Final" cuma penanda status — belum ada proteksi hapus, dipakai sebagai pengingat manual buat finance.
      </p>

      {printInv && (
        <InvoicePrint
          invoice={printInv}
          client={clients.find((c) => c.id === printInv.client_id) ?? null}
          onClose={() => setPrintInv(null)}
        />
      )}
    </AdminLayout>
  );
}

const rupiah = (n: number) => "Rp" + Math.round(Number(n) || 0).toLocaleString("id-ID");
const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("T")[0].split("-");
  return `${day}/${m}/${y}`;
};

// Angka -> teks terbilang rupiah (standar dokumen finance Indonesia). Cukup
// buat integer rupiah (angka invoice udah dibulatkan lewat rupiah()).
const SATUAN = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh",
  "sebelas", "dua belas", "tiga belas", "empat belas", "lima belas", "enam belas", "tujuh belas", "delapan belas", "sembilan belas"];
function terbilangGroup(n: number): string {
  if (n < 20) return SATUAN[n];
  if (n < 100) return `${SATUAN[Math.floor(n / 10)]} puluh${n % 10 ? " " + SATUAN[n % 10] : ""}`;
  if (n < 200) return `seratus${n % 100 ? " " + terbilangGroup(n % 100) : ""}`;
  if (n < 1000) return `${SATUAN[Math.floor(n / 100)]} ratus${n % 100 ? " " + terbilangGroup(n % 100) : ""}`;
  return "";
}
function terbilang(n: number): string {
  n = Math.round(Math.abs(n));
  if (n === 0) return "nol rupiah";
  const units: [number, string][] = [[1_000_000_000_000, "triliun"], [1_000_000_000, "miliar"], [1_000_000, "juta"], [1_000, "ribu"]];
  let out = "";
  for (const [v, label] of units) {
    const q = Math.floor(n / v);
    if (q > 0) {
      out += (q === 1 && label === "ribu" ? "seribu" : `${terbilangGroup(q)} ${label}`) + " ";
      n %= v;
    }
  }
  if (n > 0) out += terbilangGroup(n) + " ";
  return out.trim() + " rupiah";
}

// Dokumen invoice cetak — layout Invoice Report Dash Electric. Angka diambil
// dari detail_breakdown.billing (management_fee/ppn dll); PPN diturunkan dari
// selisih total biar selalu rekonsiliasi ke total_amount tersimpan (aman juga
// buat invoice lama yang belum punya field management_fee). NPWP & no.
// rekening sengaja dikosongkan (garis kosong) — diisi tulis tangan setelah
// cetak, per keputusan user (belum ada sumber data resmi buat itu di sistem).
function InvoicePrint({ invoice, client, onClose }: { invoice: Invoice; client: Client | null; onClose: () => void }) {
  const b = invoice.detail_breakdown?.billing ?? null;
  const perRider: { units?: number }[] = invoice.detail_breakdown?.per_rider ?? [];
  const qty = perRider.reduce((s, r) => s + (Number(r.units) || 0), 0);
  const operational = Number(invoice.base_amount) || 0;
  const management = Number(b?.management_fee) || 0;
  const admin = Number(b?.admin_fee) || 0;
  const total = Number(invoice.total_amount) || 0;
  const beforeTax = operational + management + admin;
  const ppn = Math.max(0, total - beforeTax);
  const ppnPct = beforeTax > 0 ? Math.round((ppn / beforeTax) * 100) : 0;
  const period = `${fmtDate(invoice.period_start)} - ${fmtDate(invoice.period_end)}`;
  const isFinal = invoice.status === "finalized";
  const exact = { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" } as CSSProperties;

  const lines: { desc: string; qty: string; amount: number }[] = [
    { desc: `Operational fee — pengiriman ${period}`, qty: qty > 0 ? qty.toLocaleString("id-ID") : "—", amount: operational },
  ];
  if (management > 0) lines.push({ desc: "Management Fee", qty: "—", amount: management });
  if (admin > 0) lines.push({ desc: "Admin Fee", qty: "—", amount: admin });

  // Portal ke document.body — dirender inline di dalam AdminLayout, modal ini
  // kena jebakan stacking context: .admin-content (z-index:0) selalu kalah
  // dari .admin-header (sticky, z-index:10) di parent .admin-main yang sama,
  // gak peduli z-50 di sini setinggi apa (z-index nested cuma dibandingkan
  // di dalam local stacking context induknya). Portal keluar dari .admin-content
  // sepenuhnya biar z-50 dibandingkan di level root, bukan lokal.
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 overflow-auto flex justify-center p-4 sm:p-8 print:p-0 print:bg-white">
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #invoice-print-root, #invoice-print-root * { visibility: visible !important; }
        #invoice-print-root { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; }
        .no-print { display: none !important; }
        @page { margin: 12mm; }
      }`}</style>

      <div className="w-full max-w-[820px]">
        <div className="no-print flex justify-end gap-2 mb-3">
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm">
            <Printer className="w-4 h-4" /> Cetak / Simpan PDF
          </button>
          <button onClick={onClose} className="inline-flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <X className="w-4 h-4" /> Tutup
          </button>
        </div>

        <div id="invoice-print-root" style={{ background: "#fff", color: "#111", fontFamily: "Arial, sans-serif" }} className="shadow-xl">
          <div style={{ height: 16, background: "#7c5cff", ...exact }} />
          <div style={{ padding: "20px 28px 28px" }}>
            {/* Header: kop kiri, No. Invoice + status kanan */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <img src="/dash-logo.png" alt="Dash" style={{ height: 32 }} />
                <div style={{ fontSize: 10.5, lineHeight: 1.45, color: "#1e2a5a" }}>
                  <strong>PT Dash Elektrik Indonesia</strong><br />
                  One Pacific Place, Sudirman Central Business District<br />
                  15th Floor Jl. Jend. Sudirman Kav. 52-53 Jakarta 12190<br />
                  info@dashelectric.co
                </div>
              </div>
              <div style={{ textAlign: "right", minWidth: 200 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#2c2170", letterSpacing: 1 }}>INVOICE</div>
                <div style={{ fontSize: 12, marginTop: 4 }}><span style={{ color: "#666" }}>No.</span> <strong>{invoice.invoice_no ?? "—"}</strong></div>
                <div style={{ fontSize: 12 }}><span style={{ color: "#666" }}>Tanggal</span> {fmtDate(invoice.invoice_date)}</div>
                <span style={{
                  display: "inline-block", marginTop: 6, fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 999, ...exact,
                  color: isFinal ? "#1a6b3c" : "#8a6d00", background: isFinal ? "#d9f5e3" : "#fdf0c4",
                }}>{isFinal ? "FINAL" : "DRAFT"}</span>
              </div>
            </div>

            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#2c2170", margin: "0 0 4px" }}>
              {client?.name ?? "Client"} — Invoice Report
            </h1>
            <div style={{ color: "#d6236a", fontWeight: 700, marginBottom: 22 }}>Periode {period}</div>

            {/* To / Purpose */}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginBottom: 24 }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4, color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Tagihan kepada</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{client?.name ?? "—"}</div>
                <div style={{ fontSize: 12.5, color: "#333", maxWidth: 340, marginTop: 2 }}>{client?.address ?? "—"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 700, marginBottom: 4, color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Purpose</div>
                <div style={{ color: "#d6236a", fontSize: 13, fontWeight: 600 }}>Delivery Service</div>
              </div>
            </div>

            {/* Line items */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f4f4f6", color: "#2c2170", fontWeight: 700, textAlign: "left", ...exact }}>
                  <th style={{ padding: "9px 8px" }}>Product Description</th>
                  <th style={{ padding: "9px 8px", textAlign: "right", whiteSpace: "nowrap" }}>Qty</th>
                  <th style={{ padding: "9px 8px", textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "9px 8px" }}>{l.desc}</td>
                    <td style={{ padding: "9px 8px", textAlign: "right" }}>{l.qty}</td>
                    <td style={{ padding: "9px 8px", textAlign: "right", whiteSpace: "nowrap" }}>{rupiah(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <table style={{ fontSize: 13, minWidth: 340 }}>
                <tbody>
                  <tr>
                    <td style={{ padding: "5px 12px", color: "#555" }}>Total before tax</td>
                    <td style={{ padding: "5px 0", textAlign: "right", whiteSpace: "nowrap" }}>{rupiah(beforeTax)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "5px 12px", color: "#555" }}>PPN {ppnPct}%</td>
                    <td style={{ padding: "5px 0", textAlign: "right", whiteSpace: "nowrap" }}>{ppn > 0 ? rupiah(ppn) : "0"}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "8px 12px", fontWeight: 800, background: "#fff23d", fontSize: 14, ...exact }}>Total after tax</td>
                    <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 800, background: "#fff23d", whiteSpace: "nowrap", fontSize: 14, ...exact }}>{rupiah(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 14, fontSize: 12, color: "#333", fontStyle: "italic" }}>
              <strong>Terbilang:</strong> {terbilang(total)}
            </div>

            {/* Pembayaran — NPWP & no. rekening diisi manual (tulis tangan) setelah cetak */}
            <div style={{ marginTop: 20, padding: "12px 14px", background: "#f7f6ff", border: "1px solid #e3ddff", borderRadius: 8, fontSize: 12, ...exact }}>
              <div style={{ fontWeight: 700, color: "#2c2170", marginBottom: 6 }}>Pembayaran</div>
              <div style={{ display: "flex", gap: 24 }}>
                <div style={{ flex: 1 }}>NPWP: <span style={{ display: "inline-block", borderBottom: "1px dotted #999", minWidth: 140 }}>&nbsp;</span></div>
                <div style={{ flex: 1 }}>No. Rekening: <span style={{ display: "inline-block", borderBottom: "1px dotted #999", minWidth: 160 }}>&nbsp;</span></div>
              </div>
              <div style={{ color: "#666", marginTop: 6 }}>Mohon cantumkan No. Invoice pada berita transfer.</div>
            </div>

            {/* Signature */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 36 }}>
              <div style={{ textAlign: "center", minWidth: 240 }}>
                <div style={{ fontSize: 12, color: "#333", marginBottom: 56 }}>Jakarta, {fmtDate(invoice.invoice_date)}</div>
                <div style={{ borderTop: "1px solid #999", paddingTop: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>&nbsp;</div>
                  <div style={{ fontSize: 12, color: "#666" }}>Finance Manager · PT Dash Elektrik Indonesia</div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 22, borderTop: "1px solid #eee", paddingTop: 8, fontSize: 10.5, color: "#999", textAlign: "center" }}>
              Invoice ini diterbitkan secara elektronik oleh Dash PULSE.
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
