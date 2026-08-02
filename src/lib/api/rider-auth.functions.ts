import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin.server";
import { validatePinStrength } from "@/lib/pin-validator";
import { checkRateLimit, resetRateLimit, PIN_ATTEMPT_LIMIT } from "@/lib/rate-limiter";

// Riders log in with their Kode Mitra (employee_id) + a short PIN, not
// email/password. Supabase Auth is email-based under the hood, so each
// rider gets a synthetic, unreachable email derived from employee_id —
// the PIN becomes their Supabase Auth "password". Login translates
// employeeId -> this same synthetic email (see loginRider in auth.tsx).
function syntheticEmail(employeeId: string) {
  const slug = employeeId.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return `rider-${slug}@dash.internal`;
}

// Placeholder password the rider can never guess/use — set on
// activate/reset so the account exists but is unusable until the rider
// completes first-time PIN setup (which overwrites it with their own PIN).
function randomPlaceholder() {
  return `x${Math.random().toString(36).slice(2)}${Date.now().toString(36)}!Aa1`;
}

async function requireAdmin(adminToken: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(adminToken);
  if (userErr || !userRes.user) throw new Error(`Sesi admin tidak valid: ${userErr?.message ?? "no user"}`);
  const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userRes.user.id);
  if (!roles?.some((r) => r.role === "admin")) throw new Error("Hanya admin yang bisa lakukan ini");
  return supabaseAdmin;
}

// Admin: activate login for a rider. No PIN typed by admin — the rider
// sets their own PIN on first login (see setFirstTimeRiderPin below).
export const activateRiderLogin = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    adminToken: z.string().min(1),
    riderId: z.string().uuid(),
    employeeId: z.string().min(1),
    fullName: z.string().min(1),
  }))
  .handler(async ({ data }) => {
    const supabaseAdmin = await requireAdmin(data.adminToken);
    const email = syntheticEmail(data.employeeId);
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: randomPlaceholder(),
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (error) throw new Error(error.message);
    const userId = created.user.id;
    // handle_new_user trigger already inserted profiles + user_roles(role='rider').
    await supabaseAdmin.from("profiles").update({ employee_id: data.employeeId }).eq("id", userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: linkErr } = await (supabaseAdmin as any).from("riders")
      .update({ user_id: userId, must_change_pin: true }).eq("id", data.riderId);
    if (linkErr) throw new Error(linkErr.message);
    return { ok: true };
  });

// Admin: rider forgot their PIN. Scrambles the password again and flags
// must_change_pin so the rider redoes first-time setup with a fresh PIN.
export const resetRiderLogin = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    adminToken: z.string().min(1),
    userId: z.string().uuid(),
    riderId: z.string().uuid(),
  }))
  .handler(async ({ data }) => {
    const supabaseAdmin = await requireAdmin(data.adminToken);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: randomPlaceholder() });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: flagErr } = await (supabaseAdmin as any).from("riders").update({ must_change_pin: true }).eq("id", data.riderId);
    if (flagErr) throw new Error(flagErr.message);
    return { ok: true };
  });

export const unlinkRiderLogin = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    adminToken: z.string().min(1),
    riderId: z.string().uuid(),
  }))
  .handler(async ({ data }) => {
    const supabaseAdmin = await requireAdmin(data.adminToken);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabaseAdmin as any).from("riders").update({ user_id: null, must_change_pin: false }).eq("id", data.riderId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function normalizePhone(p: string) {
  return p.replace(/[^0-9]/g, "").replace(/^0/, "62");
}

// Admin: aktifkan login untuk banyak rider sekaligus (dipanggil setelah
// import CSV — rider yang statusnya masih kerja langsung bisa self-service
// bikin PIN, ga perlu di-klik "Aktifkan Login" satu-satu). Loop di server
// (bukan N request terpisah dari client) karena Supabase Admin API cuma
// bisa createUser 1-per-1, tidak ada endpoint bulk-nya.
export const activateRiderLoginsBulk = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    adminToken: z.string().min(1),
    riders: z.array(z.object({
      riderId: z.string().uuid(),
      employeeId: z.string().min(1),
      fullName: z.string().min(1),
    })).min(1).max(500),
  }))
  .handler(async ({ data }) => {
    const supabaseAdmin = await requireAdmin(data.adminToken);
    let activated = 0;
    const failed: { employeeId: string; error: string }[] = [];
    for (const r of data.riders) {
      const email = syntheticEmail(r.employeeId);
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: randomPlaceholder(),
        email_confirm: true,
        user_metadata: { full_name: r.fullName },
      });
      if (error) { failed.push({ employeeId: r.employeeId, error: error.message }); continue; }
      const userId = created.user.id;
      await supabaseAdmin.from("profiles").update({ employee_id: r.employeeId }).eq("id", userId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: linkErr } = await (supabaseAdmin as any).from("riders")
        .update({ user_id: userId, must_change_pin: true }).eq("id", r.riderId);
      if (linkErr) failed.push({ employeeId: r.employeeId, error: linkErr.message });
      else activated++;
    }
    return { activated, failed };
  });

// Rider self-service: forgot PIN. Verify Kode Mitra + WhatsApp, then
// scramble the password and flag must_change_pin so rider can redo
// first-time PIN setup.
export const riderForgotPin = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    employeeId: z.string().min(1),
    phone: z.string().min(6),
  }))
  .handler(async ({ data }) => {
    const rateLimitKey = `rider-forgot-pin:${data.employeeId.trim().toLowerCase()}`;
    const rate = checkRateLimit(rateLimitKey, PIN_ATTEMPT_LIMIT);
    if (!rate.allowed) throw new Error("Terlalu banyak percobaan — coba lagi dalam beberapa menit");

    const supabaseAdmin = getSupabaseAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rider, error } = await (supabaseAdmin as any).from("riders")
      .select("id, user_id, phone").eq("employee_id", data.employeeId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!rider || !rider.user_id) throw new Error("Kode Mitra belum aktif — hubungi admin");
    if (!rider.phone || normalizePhone(rider.phone) !== normalizePhone(data.phone)) {
      throw new Error("Nomor WhatsApp tidak cocok dengan data kami");
    }
    const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(rider.user_id, { password: randomPlaceholder() });
    if (pwErr) throw new Error(pwErr.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any).from("riders").update({ must_change_pin: true }).eq("id", rider.id);
    resetRateLimit(rateLimitKey);
    return { ok: true };
  });

// Rider self-service: verify Kode Mitra + WhatsApp number (both already on
// file), then set their own PIN for the first time. No admin token needed —
// the phone match IS the verification. Returns the synthetic email so the
// client can immediately sign in with the new PIN.
export const setFirstTimeRiderPin = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    employeeId: z.string().min(1),
    phone: z.string().min(6),
    newPin: z.string().min(4).max(8),
  }))
  .handler(async ({ data }) => {
    // Phone match adalah satu-satunya verifikasi (lihat komentar di atas) —
    // tanpa rate limit, ini bisa dibrute-force nebak nomor WhatsApp per rider.
    const rateLimitKey = `rider-first-time-pin:${data.employeeId.trim().toLowerCase()}`;
    const rate = checkRateLimit(rateLimitKey, PIN_ATTEMPT_LIMIT);
    if (!rate.allowed) {
      throw new Error("Terlalu banyak percobaan — coba lagi dalam beberapa menit");
    }

    const pinCheck = validatePinStrength(data.newPin);
    if (!pinCheck.valid) throw new Error(pinCheck.error ?? "PIN tidak valid");

    const supabaseAdmin = getSupabaseAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rider, error } = await (supabaseAdmin as any).from("riders")
      .select("id, user_id, phone, must_change_pin").eq("employee_id", data.employeeId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!rider || !rider.user_id) throw new Error("Kode Mitra belum aktif — hubungi admin");
    if (!rider.must_change_pin) throw new Error("PIN sudah pernah di-set — pakai login biasa, atau minta admin reset");
    if (!rider.phone || normalizePhone(rider.phone) !== normalizePhone(data.phone)) {
      throw new Error("Nomor WhatsApp tidak cocok dengan data kami");
    }
    const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(rider.user_id, { password: data.newPin });
    if (pwErr) throw new Error(pwErr.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any).from("riders").update({ must_change_pin: false }).eq("id", rider.id);
    resetRateLimit(rateLimitKey); // berhasil → jangan bebankan attempt gagal sebelumnya
    return { email: syntheticEmail(data.employeeId) };
  });
