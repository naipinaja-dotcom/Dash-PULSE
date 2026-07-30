import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin.server";

// Sama seperti requireAdmin di pnl-push.functions.ts — dicek ulang di sini
// (bukan di-share) supaya file ini tetap bisa dibaca berdiri sendiri.
async function requireAdmin(adminToken: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(adminToken);
  if (userErr || !userRes.user) throw new Error(`Sesi admin tidak valid: ${userErr?.message ?? "no user"}`);
  const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userRes.user.id);
  if (!roles?.some((r) => r.role === "admin")) throw new Error("Hanya admin yang bisa lakukan ini");
}

// Auto-isi "district" dari koordinat Lat/Long — dipakai upload Delivery
// (admin.upload.tsx) waktu CSV punya kolom Lat/Long tapi district-nya
// kosong/gak ada sama sekali. Pakai ORS Reverse Geocoding (Pelias), free
// tier 40 req/menit & 2000/hari — dedup titik yang sama (dibulatkan 4
// desimal, ~11m) dan jeda 1.6s antar-request biar gak kena rate limit.
//
// Fallback: kalau ORS gak ngasih area spesifik (null), coba point-in-polygon
// ke tabel PostGIS `area_boundaries` (RPC area_at_point) — batas Kabupaten/Kota
// ADM2 Jabodetabek, backend only. Balikin nama kanonik "Kota X"/"Kabupaten X"
// yang match key pricing per-area. Lihat migration 20260730000002.
export const reverseGeocodeDistricts = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      adminToken: z.string().min(1),
      points: z.array(z.object({ lat: z.number(), lng: z.number() })),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.adminToken);
    const supabaseAdmin = getSupabaseAdmin();
    const apiKey = process.env.ORS_API_KEY?.trim();
    if (!apiKey) throw new Error("ORS_API_KEY belum di-set di server");

    const areaFromDb = async (p: { lat: number; lng: number }): Promise<string | null> => {
      try {
        const { data: area } = await supabaseAdmin.rpc("area_at_point", { p_lat: p.lat, p_lng: p.lng });
        return (area as string | null) ?? null;
      } catch {
        return null;
      }
    };

    const keyOf = (p: { lat: number; lng: number }) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    const uniquePoints = new Map<string, { lat: number; lng: number }>();
    data.points.forEach((p) => uniquePoints.set(keyOf(p), p));

    const districtByKey = new Map<string, string | null>();
    for (const [key, p] of uniquePoints) {
      let district: string | null = null;
      try {
        const url = `https://api.openrouteservice.org/geocode/reverse?api_key=${apiKey}&point.lon=${p.lng}&point.lat=${p.lat}&size=1`;
        const res = await fetch(url);
        const json: any = await res.json();
        const props = json?.features?.[0]?.properties;
        district = props?.county || props?.localadmin || props?.locality || null;
      } catch {
        district = null;
      }
      if (!district) district = await areaFromDb(p);
      districtByKey.set(key, district);
      await new Promise((r) => setTimeout(r, 1600));
    }

    return { districts: data.points.map((p) => districtByKey.get(keyOf(p)) ?? null) };
  });
