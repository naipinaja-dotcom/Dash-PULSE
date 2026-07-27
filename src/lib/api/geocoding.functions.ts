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
export const reverseGeocodeDistricts = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      adminToken: z.string().min(1),
      points: z.array(z.object({ lat: z.number(), lng: z.number() })),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.adminToken);
    const apiKey = process.env.ORS_API_KEY?.trim();
    if (!apiKey) throw new Error("ORS_API_KEY belum di-set di server");

    const keyOf = (p: { lat: number; lng: number }) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    const uniquePoints = new Map<string, { lat: number; lng: number }>();
    data.points.forEach((p) => uniquePoints.set(keyOf(p), p));

    const districtByKey = new Map<string, string | null>();
    // ponytail: debug log sementara buat lihat bentuk respons ORS asli — hapus
    // setelah ketauan kenapa district ke-isi salah (lihat percakapan 2026-07-27).
    let debugLogged = 0;
    for (const [key, p] of uniquePoints) {
      try {
        const url = `https://api.openrouteservice.org/geocode/reverse?api_key=${apiKey}&point.lon=${p.lng}&point.lat=${p.lat}&size=1`;
        const res = await fetch(url);
        const json: any = await res.json();
        if (debugLogged < 5) {
          console.log("[geocode-debug]", JSON.stringify({ lat: p.lat, lng: p.lng, status: res.status, json }));
          debugLogged++;
        }
        const props = json?.features?.[0]?.properties;
        districtByKey.set(key, props?.county || props?.localadmin || props?.locality || null);
      } catch (e) {
        if (debugLogged < 5) {
          console.log("[geocode-debug]", JSON.stringify({ lat: p.lat, lng: p.lng, error: (e as Error).message }));
          debugLogged++;
        }
        districtByKey.set(key, null);
      }
      await new Promise((r) => setTimeout(r, 1600));
    }

    return { districts: data.points.map((p) => districtByKey.get(keyOf(p)) ?? null) };
  });
