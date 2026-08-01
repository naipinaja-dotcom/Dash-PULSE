import { useState, type CSSProperties } from "react";
import { formatRupiah, formatTanggal } from "@/lib/format";
import { Download, Printer, FileDown, ChevronDown } from "lucide-react";

const exact: CSSProperties = { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" as any };

export type PayslipPrintProps = {
  slip: {
    published_at: string;
    data: { delivery_count: number; gross_earning: number; total_deduction: number; net_pay: number };
    payroll_runs: { name: string; period_start: string; period_end: string } | null;
  };
  riderName: string;
  employeeId: string;
  clients: { client_id: string; client_name: string; delivery_count: number; gross_earning: number }[];
  incentives: { name: string; amount: number }[];
  deductions: { name: string; amount: number }[];
  onClose: () => void;
};

export function PayslipPrint({ slip, riderName, employeeId, clients, incentives, deductions, onClose }: PayslipPrintProps) {
  const period = slip.payroll_runs;
  const d = slip.data;
  const totalIncentive = incentives.reduce((s, x) => s + x.amount, 0);
  const totalDeduction = deductions.reduce((s, x) => s + x.amount, 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function savePdf() {
    setSaving(true);
    setMenuOpen(false);
    const el = document.getElementById("payslip-print-root");
    if (!el) { setSaving(false); return; }
    const html2pdf = (await import("html2pdf.js")).default;
    const name = `slip-gaji-${riderName.replace(/\s+/g, "-").toLowerCase()}-${period?.period_start ?? "payroll"}.pdf`;
    await html2pdf().set({ margin: [10, 8], filename: name, html2canvas: { scale: 2 }, jsPDF: { format: "a4" } }).from(el).save();
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 overflow-auto flex justify-center p-4 sm:p-8 print:p-0 print:bg-white" onClick={onClose}>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #payslip-print-root, #payslip-print-root * { visibility: visible !important; }
        #payslip-print-root { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; }
        .no-print { display: none !important; }
        @page { margin: 12mm; size: A4; }
      }`}</style>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[210mm] h-fit">
        <div className="no-print flex justify-end gap-2 mb-3">
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              {saving ? "Menyimpan..." : "Unduh / Cetak"}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-1 w-48 rounded-lg border border-border bg-card shadow-lg py-1 z-10">
                <button onClick={savePdf}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted flex items-center gap-2">
                  <FileDown className="w-4 h-4" /> Simpan PDF
                </button>
                <button onClick={() => { setMenuOpen(false); window.print(); }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted flex items-center gap-2">
                  <Printer className="w-4 h-4" /> Cetak
                </button>
              </div>
            )}
          </div>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-muted text-sm font-medium hover:opacity-80">
            Tutup
          </button>
        </div>

        <div id="payslip-print-root" style={{ background: "#fff", color: "#111", fontFamily: "Arial, sans-serif", fontSize: 13 }} className="shadow-xl">
          <div style={{ height: 10, background: "#7c5cff", ...exact }} />
          <div style={{ padding: "20px 28px 28px" }}>
            {/* header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <img src="/dash-logo.png" alt="DASH" style={{ height: 32 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                </div>
                <div style={{ fontSize: 11, color: "#666" }}>PT. Dash Elektrik Indonesia</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11 }}>
                <div style={{ fontWeight: 600 }}>{period?.name ?? "Payroll"}</div>
                <div style={{ color: "#666" }}>
                  {period ? `${formatTanggal(period.period_start)} – ${formatTanggal(period.period_end)}` : ""}
                </div>
                <div style={{ color: "#999", marginTop: 2 }}>
                  Diterbitkan: {formatTanggal(slip.published_at.slice(0, 10))}
                </div>
              </div>
            </div>

            {/* rider info */}
            <div style={{ background: "#f8f7ff", borderRadius: 6, padding: "10px 14px", marginBottom: 16, ...exact }}>
              <table style={{ fontSize: 12 }}>
                <tbody>
                  <tr><td style={{ color: "#666", paddingRight: 16, paddingBottom: 2 }}>Nama</td><td style={{ fontWeight: 600 }}>{riderName}</td></tr>
                  <tr><td style={{ color: "#666", paddingRight: 16 }}>Kode Mitra</td><td style={{ fontWeight: 600 }}>{employeeId}</td></tr>
                </tbody>
              </table>
            </div>

            {/* earnings per client */}
            <SectionLabel>Pendapatan per Client</SectionLabel>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 16 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e0e0e0" }}>
                  <th style={{ textAlign: "left", padding: "6px 0", fontWeight: 600 }}>Client</th>
                  <th style={{ textAlign: "center", padding: "6px 8px", fontWeight: 600 }}>Order</th>
                  <th style={{ textAlign: "right", padding: "6px 0", fontWeight: 600 }}>Fee</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.client_id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "6px 0" }}>{c.client_name}</td>
                    <td style={{ textAlign: "center", padding: "6px 8px" }}>{c.delivery_count}</td>
                    <td style={{ textAlign: "right", padding: "6px 0", fontFamily: "monospace" }}>{formatRupiah(c.gross_earning)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid #e0e0e0", fontWeight: 700 }}>
                  <td style={{ padding: "8px 0" }}>Fee Kotor</td>
                  <td style={{ textAlign: "center", padding: "8px 8px" }}>{d?.delivery_count ?? 0}</td>
                  <td style={{ textAlign: "right", padding: "8px 0", fontFamily: "monospace" }}>{formatRupiah(d?.gross_earning)}</td>
                </tr>
              </tbody>
            </table>

            {/* incentives */}
            {incentives.length > 0 && (
              <>
                <SectionLabel>Insentif Tambahan</SectionLabel>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 16 }}>
                  <tbody>
                    {incentives.map((inc, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "5px 0" }}>{inc.name}</td>
                        <td style={{ textAlign: "right", padding: "5px 0", fontFamily: "monospace", color: "#16a34a" }}>+{formatRupiah(inc.amount)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: "2px solid #e0e0e0", fontWeight: 700 }}>
                      <td style={{ padding: "6px 0" }}>Total Insentif</td>
                      <td style={{ textAlign: "right", padding: "6px 0", fontFamily: "monospace", color: "#16a34a" }}>+{formatRupiah(totalIncentive)}</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}

            {/* deductions */}
            {deductions.length > 0 && (
              <>
                <SectionLabel>Potongan</SectionLabel>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 16 }}>
                  <tbody>
                    {deductions.map((ded, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "5px 0" }}>{ded.name}</td>
                        <td style={{ textAlign: "right", padding: "5px 0", fontFamily: "monospace", color: "#dc2626" }}>−{formatRupiah(ded.amount)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: "2px solid #e0e0e0", fontWeight: 700 }}>
                      <td style={{ padding: "6px 0" }}>Total Potongan</td>
                      <td style={{ textAlign: "right", padding: "6px 0", fontFamily: "monospace", color: "#dc2626" }}>−{formatRupiah(totalDeduction)}</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}

            {/* summary box */}
            <div style={{ background: "#7c5cff", color: "#fff", borderRadius: 8, padding: "14px 18px", marginTop: 8, ...exact }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span>Fee Kotor</span><span style={{ fontFamily: "monospace" }}>{formatRupiah(d?.gross_earning)}</span>
              </div>
              {totalIncentive > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span>Insentif</span><span style={{ fontFamily: "monospace" }}>+{formatRupiah(totalIncentive)}</span>
                </div>
              )}
              {totalDeduction > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span>Potongan</span><span style={{ fontFamily: "monospace" }}>−{formatRupiah(totalDeduction)}</span>
                </div>
              )}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.3)", marginTop: 6, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>TAKE-HOME PAY</span>
                <span style={{ fontSize: 20, fontWeight: 700, fontFamily: "monospace" }}>{formatRupiah(d?.net_pay)}</span>
              </div>
            </div>

            {/* footer */}
            <div style={{ marginTop: 20, paddingTop: 12, borderTop: "1px solid #e0e0e0", display: "flex", justifyContent: "flex-end", fontSize: 10, color: "#999" }}>
              <span>Halaman 1 dari 1</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#999", marginBottom: 6 }}>
      {children}
    </div>
  );
}
