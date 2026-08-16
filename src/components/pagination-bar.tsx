import { useState } from "react";

const PRESETS = [10, 20, 50, 100];

export function PageSizeSelect({ pageSize, setPageSize }: { pageSize: number; setPageSize: (n: number) => void }) {
  const [customOpen, setCustomOpen] = useState(false);
  const isPreset = PRESETS.includes(pageSize);

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-muted-foreground whitespace-nowrap">Tampilkan</label>
      <select
        value={isPreset ? pageSize : "custom"}
        onChange={(e) => {
          if (e.target.value === "custom") { setCustomOpen(true); return; }
          setCustomOpen(false);
          setPageSize(Number(e.target.value));
        }}
        className="rounded-lg border-2 border-border-strong bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
      >
        {PRESETS.map((n) => <option key={n} value={n}>{n}</option>)}
        <option value="custom">Custom{!isPreset ? ` (${pageSize})` : ""}</option>
      </select>
      {customOpen && (
        <input
          type="number"
          min={1}
          autoFocus
          placeholder="Jumlah"
          className="w-20 rounded-lg border-2 border-border-strong bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (n > 0) setPageSize(n);
          }}
          onBlur={() => setCustomOpen(false)}
        />
      )}
    </div>
  );
}

export function PaginationBar({
  page, totalPages, setPage, from, to, total,
}: { page: number; totalPages: number; setPage: (fn: (p: number) => number) => void; from: number; to: number; total: number }) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-sm text-muted-foreground">
      <span>Menampilkan {from}–{to} dari {total}</span>
      <div className="flex items-center gap-2">
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
          className="px-3 py-1 rounded-lg border-2 border-border-strong font-medium shadow-[2px_2px_0_0_var(--color-border-strong)] disabled:opacity-40 disabled:shadow-none hover:bg-muted active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-[transform,box-shadow]">
          Sebelumnya
        </button>
        <span>Halaman {page} / {totalPages}</span>
        <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
          className="px-3 py-1 rounded-lg border-2 border-border-strong font-medium shadow-[2px_2px_0_0_var(--color-border-strong)] disabled:opacity-40 disabled:shadow-none hover:bg-muted active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-[transform,box-shadow]">
          Berikutnya
        </button>
      </div>
    </div>
  );
}
