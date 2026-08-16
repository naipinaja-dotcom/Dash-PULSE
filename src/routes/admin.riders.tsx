import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";
import { parseCSV, toCSV, downloadCSV } from "@/lib/csv";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import { DatePicker } from "@/components/date-picker";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { activateRiderLogin, activateRiderLoginsBulk, resetRiderLogin, unlinkRiderLogin } from "@/lib/api/rider-auth.functions";
import { Plus, Pencil, Trash2, Loader2, AlertCircle, Upload, Download, X, Search, KeyRound, ChevronDown } from "lucide-react";

export const Route = createFileRoute("/admin/riders")({ component: RidersPage });

type RiderStatus = "ready_to_work" | "active" | "resign" | "blacklisted" | "withdrawn" | "suspended";
const STATUS_LABEL: Record<RiderStatus, string> = {
  ready_to_work: "Ready to Work", active: "Active", resign: "Resign",
  blacklisted: "Blacklisted", withdrawn: "Withdrawn", suspended: "Suspend",
};
const STATUS_ORDER: RiderStatus[] = ["ready_to_work", "active", "resign", "blacklisted", "withdrawn", "suspended"];
const STATUS_DOT: Record<"all" | RiderStatus, string> = {
  all: "bg-primary", ready_to_work: "bg-blue-500", active: "bg-emerald-500",
  resign: "bg-gray-400", blacklisted: "bg-red-500", withdrawn: "bg-amber-500", suspended: "bg-rose-500",
};
type Rider = {
  id: string; employee_id: string; full_name: string; phone: string | null; email: string | null;
  client_id: string | null; status: string; join_date: string | null;
  bank_name: string | null; bank_account: string | null; notes: string | null;
  nik?: string | null; bank_account_holder?: string | null; birth_date?: string | null; birth_place?: string | null;
  user_id?: string | null; must_change_pin?: boolean;
};
type Client = { id: string; name: string };

function RidersPage() {
  const { t } = useT();
  const [rows, setRows] = useState<Rider[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [filter, setFilter] = useState<"all" | RiderStatus>("all");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Rider | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (statusRef.current && !statusRef.current.contains(e.target as Node)) setStatusOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const load = async () => {
    setLoading(true);
    const [r, c] = await Promise.all([
      supabase.from("riders").select("*").order("full_name"),
      supabase.from("clients").select("id, name").order("name"),
    ]);
    if (r.error) toast.error(r.error.message); else setRows(r.data ?? []);
    if (!c.error) setClients(c.data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const handleDelete = async (r: Rider) => {
    if (
      !(await confirmDialog({
        title: `Hapus rider "${r.full_name}"?`,
        description: `(${r.employee_id}) — Data delivery & attendance tetap aman, cuma profil rider yang dihapus.`,
        confirmText: "Hapus",
      }))
    )
      return;
    setDeletingId(r.id);
    const { error } = await supabase.from("riders").delete().eq("id", r.id);
    setDeletingId(null);
    if (error) {
      toast.error("Gagal hapus: " + error.message);
    } else {
      toast.success("Rider berhasil dihapus");
      load();
    }
  };

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const toggleStatus = async (r: Rider) => {
    const next: RiderStatus = r.status === "active" ? "withdrawn" : "active";
    setTogglingId(r.id);
    const { error } = await supabase.from("riders").update({ status: next }).eq("id", r.id);
    setTogglingId(null);
    if (error) return toast.error(error.message);
    toast.success(`${r.full_name} → ${STATUS_LABEL[next]}`);
    load();
  };

  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) =>
    (filter === "all" || r.status === filter) &&
    (!q || r.full_name.toLowerCase().includes(q) || r.employee_id.toLowerCase().includes(q))
  );
  const { pageSize, setPageSize, page, setPage, totalPages, paged, from, to, total } = usePagination(filtered, 10);
  const statusBadge = (s: string) => {
    const map: Record<RiderStatus, string> = {
      ready_to_work: "border-2 border-border-strong bg-primary text-primary-foreground",
      active: "border-2 border-border-strong bg-success text-success-foreground",
      resign: "bg-muted text-muted-foreground",
      withdrawn: "border-2 border-border-strong bg-warning text-warning-foreground",
      blacklisted: "border-2 border-border-strong bg-destructive text-destructive-foreground",
      suspended: "border-2 border-border-strong bg-destructive text-destructive-foreground",
    };
    const cls = map[s as RiderStatus] ?? "bg-muted text-muted-foreground";
    const label = STATUS_LABEL[s as RiderStatus] ?? s.replace(/_/g, " ");
    return <span className={`px-2 py-0.5 rounded-full text-xs inline-flex items-center gap-1 ${cls}`}>
      {(s === "blacklisted" || s === "suspended") && <AlertCircle className="w-3 h-3" />}{label}
    </span>;
  };

  const getInitials = (name: string) =>
    name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <AdminLayout title={t("riders.title")} subtitle={t("riders.subtitle")}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("riders.searchPlaceholder")}
            className="w-full rounded-lg border-2 border-border-strong bg-card pl-9 pr-3 py-2 text-[12px] outline-none focus:ring-1 focus:ring-ring transition-colors"
          />
        </div>
        <div ref={statusRef} className="relative">
          <button onClick={() => setStatusOpen((p) => !p)}
            className="flex items-center gap-2 rounded-lg border-2 border-border-strong bg-card px-3 py-2 text-[12px] font-medium hover:bg-muted transition-colors min-w-[160px]">
            <span className={`w-2 h-2 rounded-full ${STATUS_DOT[filter]}`} />
            <span className="font-medium">{filter === "all" ? t("btn.all") : STATUS_LABEL[filter]}</span>
            <ChevronDown className={`w-3.5 h-3.5 ml-auto text-muted-foreground transition-transform ${statusOpen ? "rotate-180" : ""}`} />
          </button>
          {statusOpen && (
            <div className="absolute top-full left-0 mt-1 w-48 rounded-lg border-2 border-border-strong bg-card shadow-[4px_4px_0_0_var(--color-border-strong)] z-20 py-1">
              {(["all", ...STATUS_ORDER] as const).map((s) => (
                <button key={s} onClick={() => { setFilter(s); setStatusOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-left transition-colors ${filter === s ? "bg-primary text-primary-foreground border-2 border-border-strong font-medium" : "text-foreground hover:bg-muted"}`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[s]}`} />
                  {s === "all" ? t("btn.all") : STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 items-center ml-auto">
          <PageSizeSelect pageSize={pageSize} setPageSize={setPageSize} />
          <button onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border-2 border-border-strong bg-card px-3 py-1.5 text-[11px] text-muted-foreground hover:text-primary hover:bg-muted transition-colors">
            <Upload className="w-3.5 h-3.5" /> {t("btn.importCsv")}
          </button>
          <button onClick={() => { setEdit(null); setOpen(true); }}
            className="inline-flex items-center gap-1.5 rounded-lg border-2 border-border-strong bg-primary text-primary-foreground px-3 py-1.5 text-[11px] font-bold shadow-[3px_3px_0_0_var(--color-border-strong)] hover:brightness-105 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-[filter,transform,box-shadow]">
            <Plus className="w-3.5 h-3.5" /> {t("btn.addRider")}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border-[3px] border-border-strong bg-card shadow-[6px_6px_0_0_var(--color-border-strong)] overflow-auto">
        <table className="w-full text-[12px] whitespace-nowrap">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">Rider</th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">NIK</th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">WhatsApp</th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">Bank</th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">No. Rekening</th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">Status</th>
              <th className="text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pr-3">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="p-8 text-center"><Loader2 className="w-4 h-4 animate-spin inline text-primary" /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground text-[11px]">Tidak ada rider ditemukan</td></tr>
            ) : (
              paged.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors cursor-pointer">
                  <td className="p-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground border-2 border-border-strong grid place-items-center text-[11px] font-semibold flex-shrink-0">
                        {getInitials(r.full_name)}
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">{r.full_name}</div>
                        <div className="text-[10px] text-muted-foreground" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{r.employee_id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-muted-foreground">{r.nik ?? "—"}</td>
                  <td className="p-3 text-muted-foreground">{r.phone ?? "—"}</td>
                  <td className="p-3 text-muted-foreground">{r.bank_name ?? "—"}</td>
                  <td className="p-3 text-muted-foreground" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px" }}>{r.bank_account ?? "—"}</td>
                  <td className="p-3">{statusBadge(r.status)}</td>
                  <td className="text-right pr-3">
                    <button onClick={() => { setEdit(r); setOpen(true); }} className="p-1.5 hover:bg-muted rounded-md mr-1 text-muted-foreground hover:text-foreground transition-colors" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => handleDelete(r)} disabled={deletingId === r.id} title="Hapus rider"
                      className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-md disabled:opacity-50 transition-colors">
                      {deletingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!loading && <PaginationBar page={page} totalPages={totalPages} setPage={setPage} from={from} to={to} total={total} />}
      {open && <RiderModal initial={edit} clients={clients} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load(); }} />}
      {importOpen && <RiderImportModal clients={clients} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(); }} />}
    </AdminLayout>
  );
}

function RiderImportModal({ clients, onClose, onDone }:
  { clients: Client[]; onClose: () => void; onDone: () => void }) {
  const { session } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: number; warnings: string[] } | null>(null);

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const FIELD_ALIASES: Record<string, string[]> = {
    employee_id: ["employeeid", "employee", "id", "mtr", "kodemitra", "kodemtr", "mtrcode", "idkaryawan", "kodekaryawan"],
    nik: ["nik", "nomorinduk", "noktp"],
    full_name: ["fullname", "name", "nama", "namalengkap"],
    phone: ["phone", "telepon", "telp", "hp", "nohp", "notelp", "nowa", "whatsapp", "wa", "nomorwhatsapp"],
    email: ["email"],
    client: ["client", "klien", "clientpitstop"],
    status: ["status"],
    bank_name: ["bankname", "bank", "namabank"],
    bank_account: ["bankaccount", "norekening", "nomorrekening", "rekening", "norek", "account"],
    bank_account_holder: ["bankaccountholder", "namapemilikrekening", "pemilikrekening", "namarekening"],
    birth_date: ["birthdate", "tanggallahir", "ttl", "lahir"],
    birth_place: ["birthplace", "tempatlahir"],
    notes: ["notes", "catatan", "note"],
  };

  const onFile = async (file: File) => {
    setResult(null);
    const text = await file.text();
    const parsed = parseCSV(text);
    if (parsed.length < 2) return toast.error("CSV kosong atau cuma ada header");
    const headers = parsed[0];
    const colMap: Record<number, string> = {};
    headers.forEach((h, i) => {
      const nh = norm(h);
      for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
        if (nh === norm(field) || aliases.includes(nh)) { colMap[i] = field; break; }
      }
    });
    const objs = parsed.slice(1)
      .filter((r) => r.some((c) => c.trim()))
      .map((r) => {
        const o: Record<string, string> = {};
        r.forEach((val, i) => { if (colMap[i]) o[colMap[i]] = val.trim(); });
        return o;
      });
    setRows(objs);
    setFileName(file.name);
  };

  const template = () => {
    downloadCSV("template-rider.csv", toCSV([
      ["employee_id", "nik", "full_name", "phone", "email", "client", "status", "bank_name", "bank_account", "bank_account_holder", "birth_date", "birth_place", "notes"],
      ["MTR001", "3201234567890001", "Budi Santoso", "08123456789", "budi@mail.com", "Alfagift", "active", "BCA", "1234567890", "Budi Santoso", "1990-01-01", "Jakarta", ""],
    ]));
  };

  // CSV Tanggal Lahir biasanya format Indonesia DD-MM-YYYY (mis. "15-02-1994"),
  // tapi kolom birth_date di DB bertipe `date` (butuh YYYY-MM-DD). Dikirim
  // mentah bikin Postgres salah baca angka hari sebagai bulan -> error
  // "date/time field value out of range" kalau hari > 12.
  const parseBirthDate = (raw: string): string | null => {
    const t = raw.trim();
    if (!t) return null;
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) return t; // udah ISO
    const m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/); // DD-MM-YYYY atau DD/MM/YYYY
    if (!m) return null;
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  };

  const doImport = async () => {
    if (rows.length === 0) return toast.error("Upload CSV dulu");
    setImporting(true);
    const warnings: string[] = [];
    const clientByName = new Map(clients.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const validStatus: string[] = STATUS_ORDER;
    const STATUS_ALIASES: Record<string, RiderStatus> = {
      ready_to_work: "ready_to_work", ready: "ready_to_work", available: "ready_to_work", hire: "ready_to_work",
      active: "active", probation: "active", contract: "active",
      resign: "resign", resigned: "resign", mengundurkandiri: "resign",
      blacklisted: "blacklisted", blacklist: "blacklisted", banned: "blacklisted",
      withdrawn: "withdrawn", inactive: "withdrawn",
      suspended: "suspended", suspend: "suspended", pending_review: "ready_to_work",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any[] = [];
    rows.forEach((o, idx) => {
      const line = idx + 2;
      if (!o.employee_id || !o.full_name) { warnings.push(`Baris ${line}: employee_id / nama kosong — dilewat`); return; }
      let client_id: string | null = null;
      if (o.client) {
        const hit = clientByName.get(o.client.trim().toLowerCase());
        if (hit) client_id = hit;
        else warnings.push(`Baris ${line}: client "${o.client}" tidak ditemukan — dikosongkan`);
      }
      const rawStatus = (o.status || "active").toLowerCase().replace(/\s+/g, "_");
      let status: string = STATUS_ALIASES[rawStatus] ?? rawStatus;
      if (!validStatus.includes(status)) { warnings.push(`Baris ${line}: status "${o.status}" tidak dikenal — pakai "active"`); status = "active"; }
      const birth_date = parseBirthDate(o.birth_date || "");
      if (o.birth_date && !birth_date) warnings.push(`Baris ${line}: tanggal lahir "${o.birth_date}" tidak dikenal formatnya — dikosongkan`);
      payload.push({
        employee_id: o.employee_id, full_name: o.full_name,
        nik: o.nik || null, phone: o.phone || null, email: o.email || null, client_id, status,
        bank_name: o.bank_name || null, bank_account: o.bank_account || null, bank_account_holder: o.bank_account_holder || null,
        birth_date, birth_place: o.birth_place || null, notes: o.notes || null,
      });
    });
    if (payload.length === 0) { setImporting(false); return toast.error("Tidak ada baris valid untuk diimpor"); }
    let ok = 0;
    for (let i = 0; i < payload.length; i += 200) {
      const chunk = payload.slice(i, i + 200);
      const { error } = await supabase.from("riders").upsert(chunk, { onConflict: "employee_id" });
      if (error) { setImporting(false); return toast.error(`Gagal simpan: ${error.message}`); }
      ok += chunk.length;
    }

    // Auto-aktifkan login rider yang masih kerja (ready_to_work/active) —
    // admin ga perlu klik "Aktifkan Login" satu-satu lagi buat tiap rider
    // hasil import CSV. Resign/blacklisted/withdrawn/suspend sengaja
    // di-skip (ga boleh langsung dikasih akses login).
    let activated = 0;
    const activeEmployeeIds = payload
      .filter((p) => p.status === "ready_to_work" || p.status === "active")
      .map((p) => p.employee_id as string);
    if (activeEmployeeIds.length > 0 && session?.access_token) {
      const toActivate: { riderId: string; employeeId: string; fullName: string }[] = [];
      for (let i = 0; i < activeEmployeeIds.length; i += 200) {
        const chunk = activeEmployeeIds.slice(i, i + 200);
        const { data: fresh } = await supabase.from("riders")
          .select("id, employee_id, full_name, user_id").in("employee_id", chunk);
        (fresh ?? []).forEach((r) => {
          if (!r.user_id) toActivate.push({ riderId: r.id, employeeId: r.employee_id, fullName: r.full_name });
        });
      }
      for (let i = 0; i < toActivate.length; i += 500) {
        const chunk = toActivate.slice(i, i + 500);
        try {
          const result = await activateRiderLoginsBulk({ data: { adminToken: session.access_token, riders: chunk } });
          activated += result.activated;
          result.failed.forEach((f) => warnings.push(`Login "${f.employeeId}" gagal diaktifkan: ${f.error}`));
        } catch (e) {
          warnings.push(`Aktivasi login gagal: ${(e as Error).message}`);
        }
      }
    }

    setImporting(false);
    setResult({ ok, warnings });
    toast.success(`${ok} rider tersimpan` + (activated ? ` · ${activated} login rider otomatis diaktifkan` : ""));
  };

  return (
    <div className="fixed inset-0 bg-black/50 grid place-items-center z-50 p-4" onClick={onClose}>
      <div className="bg-card rounded-lg w-full max-w-lg p-5 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Import Rider dari CSV</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Upload file CSV berisi daftar rider. Wajib ada kolom <b>employee_id</b> (kode MTR) & <b>full_name</b>. Kolom lain — termasuk <b>client</b> — opsional.
          Employee ID yang sama akan di-update (bukan dobel).
        </p>
        <p className="text-xs text-muted-foreground mb-4 -mt-2">
          Catatan: rider TIDAK terikat 1 client — dia bisa jalan untuk banyak client. Client-nya nempel di tiap data pengiriman/absensi, bukan di rider. Import ini cuma buat lengkapi data profil (nama, bank, dll); rider baru juga otomatis kebuat sendiri saat kamu upload data pengiriman/absensi pakai kode MTR yang belum terdaftar.
          Rider berstatus Ready to Work/Active otomatis diaktifkan login-nya (langsung bisa "Buat PIN pertama kali" pakai Kode Mitra + Nomor WhatsApp) — Resign/Blacklisted/Withdrawn/Suspend sengaja tidak.
        </p>

        <button onClick={template} className="inline-flex items-center gap-2 text-xs text-primary mb-3 hover:underline">
          <Download className="w-3.5 h-3.5" /> Download template CSV
        </button>

        <label className="block border border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:bg-muted/40">
          <input type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
          <div className="text-sm">{fileName ? <b>{fileName}</b> : "Klik untuk pilih file CSV"}</div>
          {rows.length > 0 && <div className="text-xs text-muted-foreground mt-1">{rows.length} baris terbaca</div>}
        </label>

        {result && (
          <div className="mt-4 text-sm">
            <div className="text-success font-medium">✓ {result.ok} rider berhasil disimpan</div>
            {result.warnings.length > 0 && (
              <div className="mt-2 rounded-md border-2 border-border-strong bg-warning p-3 text-xs text-warning-foreground max-h-40 overflow-auto">
                <div className="font-medium mb-1">{result.warnings.length} peringatan:</div>
                {result.warnings.map((w, i) => <div key={i}>• {w}</div>)}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-border">
            {result ? "Tutup" : "Batal"}
          </button>
          {!result && (
            <button onClick={doImport} disabled={importing || rows.length === 0}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50">
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {importing ? "Mengimpor…" : `Import ${rows.length || ""} Rider`}
            </button>
          )}
          {result && (
            <button onClick={onDone} className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground">Selesai</button>
          )}
        </div>
      </div>
    </div>
  );
}

function RiderModal({ initial, clients, onClose, onSaved }:
  { initial: Rider | null; clients: Client[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    employee_id: initial?.employee_id ?? "",
    nik: initial?.nik ?? "",
    full_name: initial?.full_name ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    status: (initial?.status ?? "active") as RiderStatus,
    bank_name: initial?.bank_name ?? "",
    bank_account: initial?.bank_account ?? "",
    bank_account_holder: initial?.bank_account_holder ?? "",
    birth_date: initial?.birth_date ?? "",
    birth_place: initial?.birth_place ?? "",
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const { session } = useAuth();
  const [pinBusy, setPinBusy] = useState(false);
  const hasLogin = !!initial?.user_id;
  const pendingSetup = hasLogin && !!initial?.must_change_pin;

  const activateLogin = async () => {
    if (!initial || !session?.access_token) return toast.error("Sesi admin habis — login ulang");
    setPinBusy(true);
    try {
      await activateRiderLogin({ data: { adminToken: session.access_token, riderId: initial.id, employeeId: f.employee_id, fullName: f.full_name } });
      toast.success("Login diaktifkan — rider bisa set PIN sendiri lewat halaman login");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal aktifkan login");
    } finally {
      setPinBusy(false);
    }
  };

  const resetLogin = async () => {
    if (!initial?.user_id || !session?.access_token) return;
    if (!(await confirmDialog({ title: "Reset login rider?", description: `${initial.full_name} harus set PIN baru lagi lewat halaman login (Kode Mitra + Nomor WhatsApp).`, confirmText: "Reset", danger: false }))) return;
    setPinBusy(true);
    try {
      await resetRiderLogin({ data: { adminToken: session.access_token, userId: initial.user_id, riderId: initial.id } });
      toast.success("Login direset — rider perlu set PIN baru");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal reset login");
    } finally {
      setPinBusy(false);
    }
  };

  const removeLogin = async () => {
    if (!initial || !session?.access_token) return;
    if (!(await confirmDialog({ title: "Cabut akses login?", description: `${initial.full_name} tidak akan bisa login lagi sampai PIN baru dibuat.`, confirmText: "Cabut", danger: true }))) return;
    setPinBusy(true);
    try {
      await unlinkRiderLogin({ data: { adminToken: session.access_token, riderId: initial.id } });
      toast.success("Akses login dicabut");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal cabut akses");
    } finally {
      setPinBusy(false);
    }
  };

  const save = async () => {
    if (!f.employee_id || !f.full_name) return toast.error("Employee ID (MTR) & nama wajib");
    setSaving(true);
    const payload: any = { ...f };
    ["phone","email","bank_name","bank_account","bank_account_holder","birth_date","birth_place","nik","notes"].forEach((k) => { if (!payload[k]) payload[k] = null; });
    const { error } = initial
      ? await supabase.from("riders").update(payload).eq("id", initial.id)
      : await supabase.from("riders").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Tersimpan"); onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/50 grid place-items-center z-50 p-4" onClick={onClose}>
      <div className="bg-card rounded-lg w-full max-w-2xl p-5 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">{initial ? "Edit" : "Tambah"} Rider</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Catatan: rider TIDAK terikat 1 client — dia bisa jalan untuk banyak client. Client-nya nempel di tiap data pengiriman/absensi, bukan di profil rider.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Employee ID (MTR)" placeholder="MTR001" value={f.employee_id} onChange={(v) => setF({ ...f, employee_id: v })} />
          <Field label="NIK" placeholder="3201..." value={f.nik} onChange={(v) => setF({ ...f, nik: v })} />
          <Field label="Nama Lengkap" value={f.full_name} onChange={(v) => setF({ ...f, full_name: v })} />
          <Field label="Nomor WhatsApp" placeholder="0812..." value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
          <Field label="Email" value={f.email} onChange={(v) => setF({ ...f, email: v })} />
          <div>
            <label className="font-medium">Status</label>
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as RiderStatus })}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2">
              {!STATUS_ORDER.includes(f.status as RiderStatus) && (
                <option value={f.status}>{f.status} (status lama, pilih yang baru)</option>
              )}
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <Field label="Tanggal Lahir" type="date" value={f.birth_date} onChange={(v) => setF({ ...f, birth_date: v })} />
          <Field label="Tempat Lahir" value={f.birth_place} onChange={(v) => setF({ ...f, birth_place: v })} />
          <Field label="Nama Bank" value={f.bank_name} onChange={(v) => setF({ ...f, bank_name: v })} />
          <Field label="Nomor Rekening" value={f.bank_account} onChange={(v) => setF({ ...f, bank_account: v })} />
          <Field label="Nama Pemilik Rekening" value={f.bank_account_holder} onChange={(v) => setF({ ...f, bank_account_holder: v })} />
          <div className="col-span-2">
            <label className="font-medium">Catatan</label>
            <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })}
              rows={2} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" />
          </div>
        </div>

        {initial && (
          <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              <KeyRound className="w-4 h-4" /> Login Rider
              <span className={`ml-auto px-2 py-0.5 rounded-full text-xs ${hasLogin && !pendingSetup ? "border-2 border-border-strong bg-success text-success-foreground" : hasLogin ? "border-2 border-border-strong bg-warning text-warning-foreground" : "bg-muted text-muted-foreground"}`}>
                {hasLogin && !pendingSetup ? "Aktif" : hasLogin ? "Menunggu rider set PIN" : "Belum ada"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              {!hasLogin
                ? "Rider akan set PIN sendiri lewat halaman login (verifikasi pakai Kode Mitra + Nomor WhatsApp)."
                : pendingSetup
                  ? "Login sudah aktif, rider belum set PIN sendiri — arahkan ke halaman login → \"Buat PIN pertama kali\"."
                  : `Rider login pakai Kode Mitra (${f.employee_id || "—"}) + PIN yang sudah dia set sendiri.`}
            </p>
            <div className="flex gap-2">
              {!hasLogin ? (
                <button onClick={activateLogin} disabled={pinBusy} type="button"
                  className="px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50 whitespace-nowrap">
                  {pinBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Aktifkan Login"}
                </button>
              ) : (
                <button onClick={resetLogin} disabled={pinBusy} type="button"
                  className="px-3 py-2 text-sm rounded-md border border-border disabled:opacity-50 whitespace-nowrap">
                  {pinBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Reset (lupa PIN)"}
                </button>
              )}
              {hasLogin && (
                <button onClick={removeLogin} disabled={pinBusy} type="button"
                  className="px-3 py-2 text-sm rounded-md border border-destructive/40 text-destructive disabled:opacity-50 whitespace-nowrap">
                  Cabut
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-border">Batal</button>
          <button onClick={save} disabled={saving} className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50">
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="font-medium">{label}</label>
      {type === "date" ? (
        <DatePicker value={value} onChange={onChange} className="mt-1 w-full" />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type}
          className="mt-1 w-full rounded-md border-2 border-border-strong bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring" />
      )}
    </div>
  );
}
