import { supabase } from "@/integrations/supabase/client";
import { fetchLiveDeliveryRows } from "./live-fee-deliveries.functions";
import { fetchLiveAttendanceRows } from "./live-fee-attendance.functions";
import { upsertLiveDeliveries } from "@/lib/sync-live-deliveries";
import { upsertLiveAttendance } from "@/lib/sync-live-attendance";
import type { PricingScheme } from "@/lib/pricing-types";
import type { ApiProvider } from "./providers.functions";

// Untuk 1 client yang ter-map ke provider API: tarik data live (delivery dan/atau
// attendance sesuai kategori skema) untuk periode, lalu UPSERT RAW ke DB (fee=0)
// pakai admin client. Fee-nya dihitung belakangan oleh autoComputeFee (yang baca
// dari DB & update by id) — seragam untuk delivery/attendance/hybrid.
//
// Dipanggil dari workflow payroll (cron) supaya payroll run terisi otomatis dari
// data API tanpa perlu "Sync ke Database" manual.
export async function syncLiveForClient(opts: {
  admin: typeof supabase;
  clientId: string;
  provider: ApiProvider;
  scheme: PricingScheme;
  from: string;
  to: string;
}): Promise<{ delivery: number; attendance: number }> {
  const { admin, clientId, provider, scheme, from, to } = opts;

  const isAttendance = scheme.category === "attendance";
  const isHybrid = scheme.category === "hybrid";
  const paramsConfig = scheme.params.config as { delivery_component?: { enabled?: boolean } } | undefined;
  const needDelivery = !isAttendance || !!paramsConfig?.delivery_component?.enabled;
  const needAttendance = isAttendance || isHybrid;

  // businessUnit: kalau provider cuma di 1 revenue_stream, pakai itu (mempersempit
  // tarikan). Kalau lebih, biarkan null (semua BU, filter provider di sisi kita).
  const businessUnit = provider.revenueStreams.length === 1 ? provider.revenueStreams[0] : null;

  let delivery = 0;
  let attendance = 0;

  if (needDelivery) {
    const { rows } = await fetchLiveDeliveryRows(provider.id, businessUnit, from, to);
    if (rows.length > 0) {
      const res = await upsertLiveDeliveries(
        clientId,
        rows,
        `API auto · ${from}..${to}`,
        undefined, // fee=0; autoComputeFee yang hitung
        admin,
      );
      delivery = res.inserted;
    }
  }

  if (needAttendance) {
    const { rows } = await fetchLiveAttendanceRows(provider.id, from, to);
    if (rows.length > 0) {
      const res = await upsertLiveAttendance(
        clientId,
        rows,
        from,
        to,
        `API auto attendance · ${from}..${to}`,
        [], // fee=0; autoComputeFee yang hitung
        admin,
      );
      attendance = res.inserted;
    }
  }

  return { delivery, attendance };
}
