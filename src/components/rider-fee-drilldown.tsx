// Tabel rincian per-baris (order/hari) di bawah 1 rider, dipakai buat
// drill-down preview "Hitung Fee" sebelum commit — biar admin bisa cross-check
// tiap baris (jarak/berat/status) yang nyusun angka Total, bukan cuma liat
// agregat. Kolom km/kg/note ditampilin cuma kalau datanya ada (delivery vs
// attendance beda bentuk).
import { formatRupiah } from "@/lib/format";
import { useT } from "@/lib/i18n";

export interface DrilldownRow {
  date: string;
  km?: number | null;
  kg?: number | null;
  note?: string;
  fee: number;
}

export function RiderFeeDrilldown({ rows }: { rows: DrilldownRow[] }) {
  const { t } = useT();
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const subtotal = sorted.reduce((s, r) => s + r.fee, 0);
  const hasKm = sorted.some((r) => r.km !== undefined);
  const hasKg = sorted.some((r) => r.kg !== undefined);
  const hasNote = sorted.some((r) => r.note !== undefined);
  const leadingCols = 1 + (hasKm ? 1 : 0) + (hasKg ? 1 : 0) + (hasNote ? 1 : 0);

  if (sorted.length === 0) {
    return <p className="text-xs text-muted-foreground px-1">{t("feeDrilldown.empty")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs whitespace-nowrap bg-card">
        <thead className="bg-muted text-left">
          <tr>
            <th className="px-3 py-1.5">{t("feeDrilldown.date")}</th>
            {hasKm && <th className="text-right px-3">{t("feeDrilldown.km")}</th>}
            {hasKg && <th className="text-right px-3">{t("feeDrilldown.kg")}</th>}
            {hasNote && <th className="px-3">{t("feeDrilldown.status")}</th>}
            <th className="text-right px-3">{t("feeDrilldown.fee")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} className="border-t border-border">
              <td className="px-3 py-1.5">{r.date}</td>
              {hasKm && <td className="text-right px-3 tabular-nums">{r.km ?? "—"}</td>}
              {hasKg && <td className="text-right px-3 tabular-nums">{r.kg ?? "—"}</td>}
              {hasNote && <td className="px-3">{r.note ?? "—"}</td>}
              <td className="text-right px-3 tabular-nums">{formatRupiah(r.fee)}</td>
            </tr>
          ))}
          <tr className="border-t border-border-strong font-medium">
            <td className="px-3 py-1.5" colSpan={leadingCols}>
              {t("feeDrilldown.subtotal")} ({sorted.length} {t("feeDrilldown.rows")})
            </td>
            <td className="text-right px-3 tabular-nums">{formatRupiah(subtotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
