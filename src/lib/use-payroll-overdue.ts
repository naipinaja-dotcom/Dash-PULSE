import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type OverdueStatus = {
  overdue: boolean;
  daysLate: number;
  lastPeriodEnd: string | null;
};

// Toleransi: notifikasi muncul jika hari ini > period_end run terakhir + GRACE_DAYS.
// Spec PRD §5 Open Question #3 — default H+1 (beri 1 hari jeda sebelum dianggap terlambat).
const GRACE_DAYS = 1;

function diffDays(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00Z`).getTime();
  const b = new Date(`${toISO}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86_400_000);
}

// AdminLayout re-mounts on every route navigation (rendered per-page, not
// hoisted once), which re-mounts this hook and re-fires the query on every
// sidebar click. Payroll runs don't change second-to-second, so a short
// module-level cache avoids refetching the same answer dozens of times a
// minute — the real fix is hoisting AdminLayout to a persistent parent
// layout, this is the safe stopgap that doesn't touch page structure.
let cache: { status: OverdueStatus; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export function usePayrollOverdue(): OverdueStatus & { refresh: () => void } {
  const [status, setStatus] = useState<OverdueStatus>(
    cache?.status ?? { overdue: false, daysLate: 0, lastPeriodEnd: null },
  );

  const check = async (force = false) => {
    if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      setStatus(cache.status);
      return;
    }
    const { data } = await supabase
      .from("payroll_runs")
      .select("period_end, status")
      .order("period_end", { ascending: false })
      .limit(1)
      .single();

    // Run terbaru udah published = udah beres, gak peduli berapa hari sejak
    // period_end (period_end != tanggal disbursement, selalu ada lag normal).
    const next: OverdueStatus = !data?.period_end || data.status === "published"
      ? { overdue: false, daysLate: 0, lastPeriodEnd: data?.period_end ?? null }
      : (() => {
          const today = new Date().toISOString().slice(0, 10);
          const daysLate = diffDays(data.period_end, today) - GRACE_DAYS;
          return {
            overdue: daysLate > 0,
            daysLate: Math.max(0, daysLate),
            lastPeriodEnd: data.period_end,
          };
        })();
    cache = { status: next, fetchedAt: Date.now() };
    setStatus(next);
  };

  useEffect(() => {
    check();
  }, []);

  return { ...status, refresh: () => check(true) };
}
