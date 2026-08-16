import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

// Dialog konfirmasi global on-theme — pengganti window.confirm() bawaan browser.
// Pakai: `if (!(await confirmDialog({ title, description }))) return;`
export type ConfirmOpts = {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean; // true = tombol merah + ikon warning (default true)
};

let opener: ((opts: ConfirmOpts) => Promise<boolean>) | null = null;

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  if (opener) return opener(opts);
  // fallback kalau host belum ke-mount (mis. SSR)
  if (typeof window !== "undefined") return Promise.resolve(window.confirm(opts.description ?? opts.title ?? "Lanjutkan?"));
  return Promise.resolve(false);
}

export function ConfirmHost() {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    opener = (o) => new Promise<boolean>((resolve) => { resolver.current = resolve; setOpts(o); });
    return () => { opener = null; };
  }, []);

  const close = (v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null); };

  useEffect(() => {
    if (!opts) return;
    cancelRef.current?.focus(); // default fokus ke "Batal" biar aman (ga ke-Enter langsung hapus)
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opts]);

  if (!opts) return null;
  const danger = opts.danger ?? true;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in" onClick={() => close(false)} />
      <div className="relative w-full max-w-sm rounded-xl border-2 border-border-strong bg-card p-5 shadow-[8px_8px_0_0_var(--color-border-strong)] animate-in fade-in zoom-in-95">
        <div className="flex items-start gap-3">
          {danger && (
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border-2 border-border-strong bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 pt-0.5">
            <h3 className="text-sm font-semibold">{opts.title ?? "Konfirmasi"}</h3>
            {opts.description && <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line">{opts.description}</p>}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} onClick={() => close(false)}
            className="rounded-lg border-2 border-border-strong bg-card px-3.5 py-1.5 text-sm font-medium hover:bg-muted">
            {opts.cancelText ?? "Batal"}
          </button>
          <button onClick={() => close(true)}
            className={`rounded-lg border-2 border-border-strong px-3.5 py-1.5 text-sm font-bold shadow-[3px_3px_0_0_var(--color-border-strong)] hover:brightness-105 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-[filter,transform,box-shadow] ${danger ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}>
            {opts.confirmText ?? "Hapus"}
          </button>
        </div>
      </div>
    </div>
  );
}
