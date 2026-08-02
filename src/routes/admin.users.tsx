import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Search } from "lucide-react";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";

export const Route = createFileRoute("/admin/users")({ component: UsersPage });

type Row = { id: string; full_name: string | null; email: string | null; role: string | null };

// role yang app beneran pakai (admin = akses penuh, rider = terbatas)
const ROLES = ["admin", "rider"];

function initialsOf(row: Row) {
  const source = row.full_name || row.email || "?";
  return source
    .split(/[\s@.]+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function UsersPage() {
  const { t } = useT();
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    const [{ data: profiles, error: pe }, { data: roles, error: re }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email").order("email"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    if (pe || re) {
      toast.error((pe || re)!.message);
      setLoading(false);
      return;
    }
    // 1 role utama per user; kalau ada 'admin' menang
    const roleMap = new Map<string, string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (roles ?? []).forEach((r: any) => {
      if (r.role === "admin") roleMap.set(r.user_id, "admin");
      else if (!roleMap.has(r.user_id)) roleMap.set(r.user_id, r.role);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setRows(
      (profiles ?? []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        role: roleMap.get(p.id) ?? null,
      })),
    );
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const changeRole = async (uid: string, newRole: string) => {
    if (!newRole) return;
    setSavingId(uid);
    const { error } = await supabase.rpc("change_user_role" as any, {
      target_uid: uid,
      new_role: newRole,
    });
    if (error) {
      toast.error(error.message);
      setSavingId(null);
      return;
    }
    toast.success("Role diperbarui");
    setSavingId(null);
    load();
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        (r.full_name ?? "").toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const { pageSize, setPageSize, page, setPage, totalPages, paged, from, to, total } =
    usePagination(filtered, 10);

  return (
    <AdminLayout
      title={t("users.title")}
      subtitle={t("users.subtitle")}
    >
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama atau email..."
            className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-[12px] outline-none focus:border-primary transition-colors"
          />
        </div>
        <div className="ml-auto">
          <PageSizeSelect pageSize={pageSize} setPageSize={setPageSize} />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                User
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                Email
              </th>
              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3 w-52">
                Role
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="p-8 text-center">
                  <Loader2 className="w-4 h-4 animate-spin inline text-primary" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-8 text-center text-muted-foreground text-[11px]">
                  Belum ada user
                </td>
              </tr>
            ) : (
              paged.map((r) => {
                const isSelf = r.id === user?.id;
                // pastikan role saat ini selalu muncul di dropdown (mis. 'superadmin')
                const opts = Array.from(new Set([...(r.role ? [r.role] : []), ...ROLES]));
                return (
                  <tr
                    key={r.id}
                    className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-primary-soft grid place-items-center text-[11px] font-semibold text-primary flex-shrink-0">
                          {initialsOf(r)}
                        </div>
                        <div className="font-semibold text-foreground">
                          {r.full_name || "—"}
                          {isSelf && (
                            <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary-soft text-primary-soft-foreground">
                              kamu
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{r.email}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={r.role ?? ""}
                          disabled={isSelf || savingId === r.id}
                          onChange={(e) => changeRole(r.id, e.target.value)}
                          className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] outline-none focus:border-primary transition-colors disabled:opacity-50"
                          title={isSelf ? "Role sendiri dikunci biar ga ke-lock-out" : ""}
                        >
                          {!r.role && (
                            <option value="" disabled>
                              — belum ada role —
                            </option>
                          )}
                          {opts.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        {savingId === r.id && (
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
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
      <div className="flex items-start gap-2 mt-3 text-xs text-muted-foreground">
        <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          <b>admin</b> = akses penuh ke semua halaman. <b>rider</b> = cuma bisa lihat halaman rider
          (payslip dll). Role kamu sendiri dikunci supaya kamu ga ga sengaja ngilangin akses admin
          sendiri.
        </span>
      </div>
    </AdminLayout>
  );
}
