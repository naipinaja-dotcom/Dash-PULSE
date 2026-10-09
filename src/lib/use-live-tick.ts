import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Auto-refresh halaman: balikin angka yang naik (didebounce) tiap ada perubahan
// di salah satu tabel yang dipantau lewat Supabase realtime. Taruh angkanya di
// dependency effect pemuat data halaman — `useEffect(load, [tick])` — jadi data
// ke-load ulang tanpa reload browser. Tabelnya harus ada di publication
// supabase_realtime (lihat migration *_live_refresh.sql); kalau belum, hook ini
// cuma diam (gak error). Tabel yang di-insert massal (delivery_records,
// attendance_logs) JANGAN dipantau langsung — pantau upload_batches (1 event
// per upload) biar gak banjir event.
export function useLiveTick(tables: string[], delay = 800) {
  const [tick, setTick] = useState(0);
  const key = tables.join(",");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setTick((n) => n + 1), delay);
    };
    const channel = supabase.channel(`live-${key}-${Math.random().toString(36).slice(2)}`);
    for (const table of key.split(","))
      channel.on("postgres_changes", { event: "*", schema: "public", table }, bump);
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [key, delay]);
  return tick;
}
