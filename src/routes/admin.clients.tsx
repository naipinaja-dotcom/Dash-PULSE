import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";
import { fetchAllRows } from "@/lib/fetch-all";
import { Pencil, Trash2, Loader2, Search, FileSpreadsheet, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  EXPORT_COLUMNS,
  ALL_EXPORT_COLUMN_KEYS,
  getClientExportTemplate,
  saveClientExportTemplate,
} from "@/lib/export-template";
import { loadApiProviders } from "@/lib/api/providers.functions";

export const Route = createFileRoute("/admin/clients")({ component: ClientsPage });

type Client = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  contact_person: string | null;
  phone: string | null;
  active: boolean;
  contract: string | null;
  created_at: string;
};

// Map calc_type → label
const SCHEME_LABEL: Record<string, string> = {
  flat_unit: "Flat per Unit",
  tier: "Tier Jarak",
  tier_daily: "Tier Harian",
  daily_attendance: "Daily / Attendance",
  threshold_multiple: "Threshold Kelipatan",
  hybrid: "Hybrid",
};

function schemeLabel(type: string | undefined) {
  if (!type) return null;
  return SCHEME_LABEL[type] ?? type;
}

function clientInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function ClientsPage() {
  const { t } = useT();
  const [rows, setRows] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Client | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"assisted" | "self-service">("assisted");
  // client_id → calc_type of their revenue (client) pricing scheme
  const [schemeOf, setSchemeOf] = useState<Map<string, string>>(new Map());
  const [syncing, setSyncing] = useState(false);
  // nama client (lowercase) → business unit (revenue_stream provider), buat kolom BU.
  const [buOf, setBuOf] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) return;
        const { providers } = await loadApiProviders({ data: { token } });
        const m = new Map<string, string>();
        for (const p of providers) m.set(p.name.trim().toLowerCase(), p.revenueStreams.join(", "));
        setBuOf(m);
      } catch {
        /* diamkan — kolom BU tampil "—" kalau gagal */
      }
    })();
  }, []);

  // Sync client dari mgmt API: tiap provider (SCHEDULED_INSTANT + X_DOCK) jadi
  // client. Match existing by NAMA (case-insensitive) — yang belum ada dibuat.
  // Link client<->provider disimpan di clients.provider_id (dipakai cron
  // live-fee-sync yang gak punya sesi admin buat name-match runtime) — client
  // yang sudah ada tapi belum ke-link (provider_id null) di-backfill juga.
  const syncFromApi = async () => {
    setSyncing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      const { providers } = await loadApiProviders({ data: { token } });
      const { data: existing } = await (supabase as any).from("clients").select("id, name, code, provider_id");
      const byName = new Map<string, any>((existing ?? []).map((c: any) => [c.name.trim().toLowerCase(), c]));
      const haveCode = new Set((existing ?? []).map((c: any) => (c.code ?? "").trim().toUpperCase()));

      let created = 0;
      let linked = 0;
      let skippedCode = 0;
      for (const p of providers) {
        const existingClient = byName.get(p.name.trim().toLowerCase());
        if (existingClient) {
          if (existingClient.provider_id == null) {
            const { error } = await (supabase as any)
              .from("clients")
              .update({ provider_id: p.id })
              .eq("id", existingClient.id);
            if (!error) linked++;
          }
          continue;
        }
        // code wajib unik — kalau bentrok, beri suffix id biar tetap kebuat.
        let code = (p.code ?? `PRV${p.id}`).trim().toUpperCase();
        if (haveCode.has(code)) code = `${code}-${p.id}`;
        if (haveCode.has(code)) {
          skippedCode++;
          continue;
        }
        const { error } = await (supabase as any)
          .from("clients")
          .insert({ code, name: p.name, active: true, provider_id: p.id });
        if (error) {
          skippedCode++;
          continue;
        }
        byName.set(p.name.trim().toLowerCase(), { id: "", name: p.name, code, provider_id: p.id });
        haveCode.add(code);
        created++;
      }
      toast.success(
        `Sync selesai: ${created} client baru, ${linked} client lama di-link ke provider, dari ${providers.length} provider API` +
          (skippedCode ? `, ${skippedCode} dilewati (kode bentrok)` : "") +
          ".",
      );
      await load();
    } catch (e) {
      toast.error(`Sync client gagal: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [clientData, schemes] = await Promise.all([
        fetchAllRows<Client>((c, from, to) =>
          c
            .from("clients")
            .select("id, code, name, address, contact_person, phone, active, contract, created_at")
            .order("name")
            .range(from, to),
        ),
        fetchAllRows<{ client_id: string | null; calc_type: string }>((c, from, to) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (c as any)
            .from("pricing_schemes")
            .select("client_id, calc_type")
            .eq("scheme_for", "client")
            .range(from, to),
        ),
      ]);
      setRows(clientData);
      const map = new Map<string, string>();
      for (const s of schemes) if (s.client_id) map.set(s.client_id, s.calc_type);
      setSchemeOf(map);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat data client");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const remove = async (id: string) => {
    if (
      !(await confirmDialog({
        title: "Hapus client ini?",
        description: "Client akan dihapus permanen.",
        confirmText: "Hapus",
      }))
    )
      return;
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Client dihapus");
    load();
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [rows, search]);

  const { pageSize, setPageSize, page, setPage, totalPages, paged, from, to, total } =
    usePagination(filtered, 10);

  return (
    <AdminLayout title={t("clients.title")} subtitle={`${rows.length} ${t("clients.subtitle")}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama client..."
            className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-[12px] outline-none focus:border-primary transition-colors"
          />
        </div>
        <div className="flex gap-2 items-center ml-auto">
          <PageSizeSelect pageSize={pageSize} setPageSize={setPageSize} />
          <button
            onClick={syncFromApi}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-[11px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            title="Tarik semua provider (SCHEDULED_INSTANT + X_DOCK) dari API jadi client"
          >
            {syncing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {syncing ? "Menyinkron…" : "Sync dari API"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border-[3px] border-border-strong bg-card shadow-[6px_6px_0_0_var(--color-border-strong)] overflow-auto">
        <table className="w-full text-[12px] whitespace-nowrap">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                Client
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                Business Unit
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                Skema Revenue
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                Contract
              </th>
              <th className="text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pr-3">
                Aksi
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="p-8 text-center">
                  <Loader2 className="w-4 h-4 animate-spin inline text-primary" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground text-[11px]">
                  Belum ada client
                </td>
              </tr>
            ) : (
              paged.map((c) => {
                const scheme = schemeLabel(schemeOf.get(c.id));
                return (
                  <tr
                    key={c.id}
                    className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-md bg-primary text-primary-foreground border-2 border-border-strong grid place-items-center text-[11px] font-semibold flex-shrink-0">
                          {clientInitials(c.name)}
                        </div>
                        <div>
                          <div className="font-semibold text-foreground">{c.name}</div>
                          <div
                            className="text-[10px] text-muted-foreground"
                            style={{ fontFamily: "'JetBrains Mono', monospace" }}
                          >
                            {c.code}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      {(() => {
                        const bu = buOf.get(c.name.trim().toLowerCase());
                        return bu ? (
                          <span className="brutal-sticker text-[11px] font-medium bg-primary text-primary-foreground border-2 border-border-strong px-2 py-0.5 rounded-full">
                            {bu}
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        );
                      })()}
                    </td>
                    <td className="p-3">
                      {scheme ? (
                        <span className="text-[11px] font-medium bg-primary text-primary-foreground border-2 border-border-strong px-2 py-0.5 rounded-full">
                          {scheme}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      {c.contract ? (
                        <span className="inline-flex rounded-full border-2 border-border-strong bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                          {c.contract}
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium text-warning">Belum diisi</span>
                      )}
                    </td>
                    <td className="text-right pr-3">
                      <button
                        onClick={() => {
                          setEdit(c);
                          setOpen(true);
                        }}
                        className="p-1.5 hover:bg-muted rounded-md mr-1 text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => remove(c.id)}
                        className="p-1.5 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground rounded-md transition-colors"
                        title="Hapus"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {!loading && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          setPage={setPage}
          from={from}
          to={to}
          total={total}
        />
      )}

      {open && (
        <ClientModal
          initial={edit}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            load();
          }}
        />
      )}
    </AdminLayout>
  );
}

function ClientModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Client | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<"info" | "export">("info");
  const [form, setForm] = useState({
    code: initial?.code ?? "",
    name: initial?.name ?? "",
    address: initial?.address ?? "",
    contact_person: initial?.contact_person ?? "",
    phone: initial?.phone ?? "",
    active: initial?.active ?? true,
    contract: initial?.contract ?? "",
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) return toast.error("Kode & nama wajib");
    setSaving(true);
    const payload = {
      ...form,
      address: form.address || null,
      contact_person: form.contact_person || null,
      phone: form.phone || null,
      contract: form.contract || null,
    };
    const { error } = initial
      ? await supabase.from("clients").update(payload).eq("id", initial.id)
      : await supabase.from("clients").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Tersimpan");
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/50 grid place-items-center z-50 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold mb-1">{initial ? "Edit" : "Tambah"} Client</h2>

        {/* Tab — Export Template cuma relevan buat client yang udah ada (perlu client_id) */}
        {initial && (
          <div className="flex w-full border-2 border-border-strong rounded-md bg-card shadow-[4px_4px_0_0_var(--color-border-strong)] mb-4 mt-3 overflow-hidden">
            {(
              [
                ["info", "Info"],
                ["export", "Export Template"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`flex-1 px-3 py-1.5 text-xs font-bold border-l-2 border-border-strong first:border-l-0 transition-colors ${tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        {!initial && <div className="mb-3" />}

        {tab === "info" ? (
          <>
            <div className="space-y-3 text-sm">
              {(["code", "name", "address", "contact_person", "phone"] as const).map((f) => (
                <div key={f}>
                  <label className="text-xs text-muted-foreground font-medium capitalize">
                    {f.replace(/_/g, " ")}
                  </label>
                  <input
                    value={(form as any)[f]}
                    onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs text-muted-foreground font-medium">Contract</label>
                <select
                  value={form.contract}
                  onChange={(e) => setForm({ ...form, contract: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">— Belum diisi —</option>
                  <option value="DPI">PT DPI</option>
                  <option value="DEI">PT DEI</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />{" "}
                Aktif
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
              >
                Batal
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                {saving ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          </>
        ) : (
          initial && <ExportTemplateTab clientId={initial.id} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

// Tab "Export Template" — checkbox kolom mana yang muncul di export
// Ringkasan Finance Worksheet buat client ini. Setup sekali, reusable
// (dipakai otomatis di finance-worksheet.tsx tiap kali export/render
// summary utk payroll_runs yang di-scope ke client ini).
function ExportTemplateTab({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [enabled, setEnabled] = useState<Set<string>>(new Set(ALL_EXPORT_COLUMN_KEYS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getClientExportTemplate(clientId).then((cols) => {
      setEnabled(new Set(cols ?? ALL_EXPORT_COLUMN_KEYS));
      setLoading(false);
    });
  }, [clientId]);

  const toggle = (key: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      await saveClientExportTemplate(clientId, [...enabled]);
      toast.success("Export template tersimpan");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal simpan template");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 inline animate-spin mr-1" /> Memuat…
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start gap-2 rounded-md border-2 border-border-strong bg-secondary px-3 py-2.5 mb-3">
        <FileSpreadsheet className="w-4 h-4 text-foreground mt-0.5 flex-shrink-0" />
        <p className="text-xs text-foreground leading-relaxed">
          Kolom yang dicentang akan muncul di export "Ringkasan" Finance Worksheet — berlaku
          otomatis tiap kali export payroll run yang di-scope ke client ini. Kolom "Driver Name"
          selalu tampil.
        </p>
      </div>
      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {EXPORT_COLUMNS.map((col) => (
          <label
            key={col.key}
            className="flex items-start gap-2.5 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/40"
          >
            <input
              type="checkbox"
              checked={enabled.has(col.key)}
              onChange={() => toggle(col.key)}
              className="w-4 h-4 mt-0.5 flex-shrink-0"
            />
            <div>
              <span className="text-sm font-medium block">{col.label}</span>
              <span className="text-[11px] text-muted-foreground">{col.desc}</span>
            </div>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
        >
          Batal
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {saving ? "Menyimpan…" : "Simpan Template"}
        </button>
      </div>
    </>
  );
}
