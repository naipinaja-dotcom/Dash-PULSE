// Deteksi area Jabodetabek dari teks alamat bebas (destination_address) —
// dipakai admin.upload.tsx buat baris yang SAMA SEKALI gak punya koordinat
// (jadi gak bisa lewat reverse-geocode ORS/PostGIS), tapi alamatnya sendiri
// sering eksplisit nyebut kecamatan/kotamadya ("Jaksel", "Jakarta Pusat",
// dst) walau kolom District dari CSV cuma "Jakarta" polos yang ambigu.
//
// SENGAJA cuma cocokin nama LENGKAP atau singkatan yang GAK ambigu — bukan
// nama kota polos ("Bekasi", "Tangerang", "Bogor") yang di closed-set
// Jabodetabek ini beneran bisa berarti Kota ATAU Kabupaten. Mending gak
// ke-detect daripada nebak salah kota/kabupaten (sama prinsipnya kayak
// findByKey/normArea di pricing-calc.ts).
// TIER 1 — nama kota lengkap + singkatan umum (Jaksel, Jak Sel, Jkt Utara,
// format Inggris hasil reverse-geocode Google Maps "South Jakarta City",
// dst). Dicek DULUAN, dan kalau ketemu SATU match di tier ini, tier 2
// (kecamatan) diabaikan sepenuhnya — soalnya beberapa KELURAHAN kebetulan
// namanya nempel nama kecamatan lain ("Menteng Dalam"/"Menteng Atas"
// ngandung substring "Menteng", padahal itu di Tebet/Setiabudi, Jaksel,
// bukan kecamatan Menteng di Jakpus). Tanpa prioritas ini, alamat yang
// UDAH eksplisit nulis "Jakarta Selatan" malah dianggap ambigu gara-gara
// collision kelurahan yang gak ada hubungannya.
const CITY_PATTERNS: { canonical: string; keywords: string[] }[] = [
  {
    canonical: "Kota Jakarta Selatan",
    keywords: ["JAKARTA SELATAN", "JAKSEL", "JAK SEL", "JKT SELATAN", "SOUTH JAKARTA"],
  },
  {
    canonical: "Kota Jakarta Pusat",
    keywords: ["JAKARTA PUSAT", "JAKPUS", "JAK PUS", "JKT PUSAT", "CENTRAL JAKARTA"],
  },
  {
    canonical: "Kota Jakarta Utara",
    keywords: ["JAKARTA UTARA", "JAKUT", "JAK UT", "JKT UTARA", "NORTH JAKARTA"],
  },
  {
    canonical: "Kota Jakarta Barat",
    keywords: ["JAKARTA BARAT", "JAKBAR", "JAK BAR", "JKT BARAT", "WEST JAKARTA"],
  },
  {
    canonical: "Kota Jakarta Timur",
    keywords: ["JAKARTA TIMUR", "JAKTIM", "JAK TIM", "JKT TIMUR", "EAST JAKARTA"],
  },
  { canonical: "Kota Tangerang Selatan", keywords: ["TANGERANG SELATAN", "TANGSEL"] },
  { canonical: "Kota Tangerang", keywords: ["KOTA TANGERANG"] },
  { canonical: "Kabupaten Tangerang", keywords: ["KABUPATEN TANGERANG", "KAB TANGERANG"] },
  { canonical: "Kota Bekasi", keywords: ["KOTA BEKASI"] },
  { canonical: "Kabupaten Bekasi", keywords: ["KABUPATEN BEKASI", "KAB BEKASI"] },
  { canonical: "Kota Bogor", keywords: ["KOTA BOGOR"] },
  { canonical: "Kabupaten Bogor", keywords: ["KABUPATEN BOGOR", "KAB BOGOR"] },
  { canonical: "Kota Depok", keywords: ["DEPOK"] }, // gak ada "Kabupaten Depok" di closed-set ini, gak ambigu
];

/** Nama kanonik yang dianggap "udah presisi" — dipakai caller buat mutusin perlu di-enrich lagi atau nggak. */
export const PRECISE_AREA_NAMES: ReadonlySet<string> = new Set(CITY_PATTERNS.map((p) => p.canonical));

// TIER 2 — nama KECAMATAN (satu tingkat di bawah kota) — closed-set resmi 5
// kota administratif DKI Jakarta (44 kecamatan). Banyak alamat operasional
// nyebut kecamatan doang ("Kemayoran", "Tanjung Priok") tanpa nyebut nama
// kotanya sama sekali — tanpa daftar ini gak ke-detect padahal gak ambigu
// (1 kecamatan = 1 kota, gak ada kecamatan yang namanya kepake di 2 kota).
// Cuma dicek kalau TIER 1 di atas gak nemu apa-apa (lihat catatan collision).
const KECAMATAN_PATTERNS: { canonical: string; keywords: string[] }[] = [
  { canonical: "Kota Jakarta Pusat", keywords: ["CEMPAKA PUTIH", "GAMBIR", "JOHAR BARU", "KEMAYORAN", "MENTENG", "SAWAH BESAR", "SENEN", "TANAH ABANG"] },
  { canonical: "Kota Jakarta Utara", keywords: ["CILINCING", "KELAPA GADING", "KOJA", "PADEMANGAN", "PENJARINGAN", "TANJUNG PRIOK"] },
  { canonical: "Kota Jakarta Barat", keywords: ["CENGKARENG", "GROGOL PETAMBURAN", "KALIDERES", "KEBON JERUK", "KEMBANGAN", "PALMERAH", "TAMAN SARI", "TAMANSARI", "TAMBORA"] },
  { canonical: "Kota Jakarta Selatan", keywords: ["CILANDAK", "JAGAKARSA", "KEBAYORAN BARU", "KEBAYORAN LAMA", "MAMPANG PRAPATAN", "PANCORAN", "PASAR MINGGU", "PESANGGRAHAN", "SETIABUDI", "TEBET"] },
  { canonical: "Kota Jakarta Timur", keywords: ["CAKUNG", "CIPAYUNG", "CIRACAS", "DUREN SAWIT", "JATINEGARA", "KRAMAT JATI", "MAKASAR", "MATRAMAN", "PASAR REBO", "PULO GADUNG", "PULOGADUNG"] },
];

function normalizeAddress(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9\s]/g, " ").replace(/\s+/g, " ");
}

function matchTier(norm: string, patterns: { canonical: string; keywords: string[] }[]): Set<string> {
  const hits = new Set<string>();
  for (const { canonical, keywords } of patterns) {
    if (keywords.some((k) => norm.includes(k))) hits.add(canonical);
  }
  return hits;
}

/**
 * null kalau gak ketemu pola yang cocok sama sekali, ATAU ketemu >1 area
 * beda di tier yang SAMA (ambigu). Tier 1 (nama kota) menang mutlak kalau
 * dia nemu APA PUN — ambigu di tier 1 TETAP null, TIDAK lanjut ke tier 2
 * (kecamatan), karena kecamatan cuma sinyal lemah buat nge-resolve ambiguitas
 * antar-kota yang udah eksplisit disebut.
 */
export function detectAreaFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const norm = normalizeAddress(address);
  const cityHits = matchTier(norm, CITY_PATTERNS);
  if (cityHits.size > 0) return cityHits.size === 1 ? [...cityHits][0] : null;
  const kecHits = matchTier(norm, KECAMATAN_PATTERNS);
  return kecHits.size === 1 ? [...kecHits][0] : null;
}
