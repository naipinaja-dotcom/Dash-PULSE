import { useState, type CSSProperties } from "react";
import { Download, FileDown, Printer } from "lucide-react";
import { formatRupiah, formatTanggal } from "@/lib/format";

const exact: CSSProperties = { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" as never };

export type EarningsRecapPrintProps = {
  from: string;
  to: string;
  riderName: string;
  employeeId: string;
  clients: { client_id: string; client_name: string; count: number; total: number }[];
  completedOrders: number;
  completedFee: number;
  published: { slips: number; orders: number; gross: number; deduction: number; net: number };
  onClose: () => void;
};

export function EarningsRecapPrint({
  from, to, riderName, employeeId, clients, completedOrders, completedFee, published, onClose,
}: EarningsRecapPrintProps) {
  const [saving, setSaving] = useState(false);

  async function savePdf() {
    setSaving(true);
    const el = document.getElementById("earnings-recap-print-root");
    if (!el) return;
    const html2pdf = (await import("html2pdf.js")).default;
    await html2pdf().set({
      margin: [10, 8],
      filename: `rekap-pendapatan-${riderName.replace(/\s+/g, "-").toLowerCase()}-${from}-${to}.pdf`,
      html2canvas: { scale: 2 },
      jsPDF: { format: "a4" },
    }).from(el).save();
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 overflow-auto flex justify-center p-4 sm:p-8 print:p-0 print:bg-white" onClick={onClose}>
      <style>{`@media print { body * { visibility: hidden !important; } #earnings-recap-print-root, #earnings-recap-print-root * { visibility: visible !important; } #earnings-recap-print-root { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; } .no-print { display: none !important; } @page { margin: 12mm; size: A4; } }`}</style>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[210mm] h-fit">
        <div className="no-print flex justify-end gap-2 mb-3">
          <button onClick={savePdf} disabled={saving} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60 flex items-center gap-1.5">
            <Download className="w-4 h-4" />{saving ? "Menyimpan..." : "Simpan PDF"}
          </button>
          <button onClick={() => window.print()} className="px-4 py-2 rounded-lg bg-muted text-sm font-medium flex items-center gap-1.5"><Printer className="w-4 h-4" />Cetak</button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-muted text-sm font-medium">Tutup</button>
        </div>
        <div id="earnings-recap-print-root" style={{ background: "#fff", color: "#111", fontFamily: "Arial, sans-serif", fontSize: 13 }} className="shadow-xl">
          <div style={{ height: 10, background: "#7c5cff", ...exact }} />
          <div style={{ padding: "20px 28px 28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div><img src="/dash-logo.png" alt="DASH" style={{ height: 32, marginBottom: 4 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} /><div style={{ fontSize: 11, color: "#666" }}>PT. Dash Elektrik Indonesia</div></div>
              <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, fontWeight: 700 }}>REKAP PENDAPATAN RIDER</div><div style={{ fontSize: 11, color: "#666", marginTop: 3 }}>{formatTanggal(from)} - {formatTanggal(to)}</div><div style={{ fontSize: 10, color: "#999", marginTop: 3 }}>Dibuat: {formatTanggal(new Date().toISOString().slice(0, 10))}</div></div>
            </div>
            <div style={{ background: "#f8f7ff", borderRadius: 6, padding: "10px 14px", marginBottom: 16, ...exact }}><table style={{ fontSize: 12 }}><tbody><tr><td style={{ color: "#666", paddingRight: 16, paddingBottom: 2 }}>Nama</td><td style={{ fontWeight: 600 }}>{riderName}</td></tr><tr><td style={{ color: "#666", paddingRight: 16 }}>Kode Mitra</td><td style={{ fontWeight: 600 }}>{employeeId}</td></tr></tbody></table></div>
            <Label>Akumulasi Order Selesai</Label>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 18 }}><thead><tr style={{ borderBottom: "2px solid #e0e0e0" }}><th style={{ textAlign: "left", padding: "6px 0" }}>Client</th><th style={{ textAlign: "center", padding: "6px 8px" }}>Order</th><th style={{ textAlign: "right", padding: "6px 0" }}>Fee</th></tr></thead><tbody>{clients.map((client) => <tr key={client.client_id} style={{ borderBottom: "1px solid #f0f0f0" }}><td style={{ padding: "6px 0" }}>{client.client_name}</td><td style={{ textAlign: "center", padding: "6px 8px" }}>{client.count}</td><td style={{ textAlign: "right", padding: "6px 0", fontFamily: "monospace" }}>{formatRupiah(client.total)}</td></tr>)}<tr style={{ borderTop: "2px solid #e0e0e0", fontWeight: 700 }}><td style={{ padding: "8px 0" }}>Total fee order selesai</td><td style={{ textAlign: "center", padding: "8px" }}>{completedOrders}</td><td style={{ textAlign: "right", padding: "8px 0", fontFamily: "monospace" }}>{formatRupiah(completedFee)}</td></tr></tbody></table>
            <Label>Rekap Payslip Terbit</Label>
            {published.slips > 0 ? <><p style={{ fontSize: 11, color: "#666", margin: "0 0 8px" }}>{published.slips} payslip resmi - {published.orders} order pada periode ini</p><div style={{ background: "#7c5cff", borderRadius: 8, padding: "14px 18px", color: "#fff", ...exact }}><Line label="Gross" value={formatRupiah(published.gross)} /><Line label="Potongan" value={`-${formatRupiah(published.deduction)}`} /><div style={{ borderTop: "1px solid rgba(255,255,255,.3)", marginTop: 6, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ fontSize: 13, fontWeight: 700 }}>PENDAPATAN BERSIH</span><span style={{ fontSize: 20, fontWeight: 700, fontFamily: "monospace" }}>{formatRupiah(published.net)}</span></div></div></> : <div style={{ background: "#fff7ed", color: "#9a3412", borderRadius: 6, padding: "12px 14px", fontSize: 11, ...exact }}>Belum ada payslip terbit penuh pada periode ini. Akumulasi fee order di atas bukan bukti penghasilan final.</div>}
            <div style={{ marginTop: 22, paddingTop: 12, borderTop: "1px solid #e0e0e0", fontSize: 10, color: "#777", lineHeight: 1.5 }}><FileDown size={11} style={{ verticalAlign: "-2px", marginRight: 4 }} />Dokumen ini adalah rekap sistem DASH. Nilai penghasilan resmi untuk pengajuan cicilan mengacu pada bagian Rekap Payslip Terbit.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: string }) { return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#999", marginBottom: 6 }}>{children}</div>; }
function Line({ label, value }: { label: string; value: string }) { return <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}><span>{label}</span><span style={{ fontFamily: "monospace" }}>{value}</span></div>; }
