export function formatRupiah(n: number | string | null | undefined): string {
  const num = typeof n === "string" ? Number(n.replace(/\./g, "").replace(/[^\d-]/g, "")) : n ?? 0;
  if (!Number.isFinite(num as number)) return "Rp 0";
  return "Rp " + (num as number).toLocaleString("id-ID");
}

export function parseRupiah(s: string): number {
  return Number(String(s).replace(/\./g, "").replace(/[^\d-]/g, "")) || 0;
}

export const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export function formatTanggal(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getDate()} ${BULAN[date.getMonth()]} ${date.getFullYear()}`;
}
