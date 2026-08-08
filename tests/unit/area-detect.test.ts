import { describe, it, expect } from "vitest";
import { detectAreaFromAddress } from "@/lib/area-detect";

describe("detectAreaFromAddress", () => {
  it("cocokin nama lengkap dua kata (Jakarta Selatan)", () => {
    expect(detectAreaFromAddress("Jl Sudirman No 1, Jakarta Selatan")).toBe("Kota Jakarta Selatan");
  });

  it("cocokin singkatan umum (Jaksel, Jakpus)", () => {
    expect(detectAreaFromAddress("Kebayoran lama, Jaksel")).toBe("Kota Jakarta Selatan");
    expect(detectAreaFromAddress("Cempaka Baru, Kemayoran, Jakarta Pusat")).toBe("Kota Jakarta Pusat");
  });

  it("bare 'Jakarta' TANPA sub-wilayah — ambigu, gak ditebak", () => {
    expect(detectAreaFromAddress("Jl Melati No 5, Jakarta")).toBeNull();
  });

  it("bare 'Bekasi'/'Tangerang'/'Bogor' — ambigu Kota vs Kabupaten, gak ditebak", () => {
    expect(detectAreaFromAddress("Jl Raya Bekasi No 10")).toBeNull();
    expect(detectAreaFromAddress("Perumahan Griya Tangerang Indah")).toBeNull();
    expect(detectAreaFromAddress("Jl Pajajaran, Bogor")).toBeNull();
  });

  it("'Kota Bekasi' / 'Kab Bekasi' eksplisit — gak ambigu, ke-detect", () => {
    expect(detectAreaFromAddress("Jl Ahmad Yani, Kota Bekasi")).toBe("Kota Bekasi");
    expect(detectAreaFromAddress("Cikarang, Kab Bekasi")).toBe("Kabupaten Bekasi");
  });

  it("'Depok' bare tetap ke-detect (gak ada Kabupaten Depok di closed-set ini)", () => {
    expect(detectAreaFromAddress("Jl Margonda Raya, Depok")).toBe("Kota Depok");
  });

  it("alamat nyebut 2 area beda — ambigu, gak ditebak", () => {
    expect(detectAreaFromAddress("Dari Jakarta Selatan pindah ke Jakarta Utara")).toBeNull();
  });

  it("singkatan 'Jkt Utara' & format Inggris 'South Jakarta City'", () => {
    expect(detectAreaFromAddress("Klp. Gading, Jkt Utara, Daerah Khusus Ibukota Jakarta")).toBe("Kota Jakarta Utara");
    expect(detectAreaFromAddress("Kemang, South Jakarta City, Jakarta")).toBe("Kota Jakarta Selatan");
  });

  // "Menteng Dalam" (kelurahan di Tebet/Jaksel) ngandung substring "MENTENG"
  // yang collide sama kecamatan Menteng (beda tempat, Jakpus) — tapi alamat
  // ini juga eksplisit nyebut "South Jakarta City" (tier kota, lebih kuat),
  // jadi menang duluan TANPA sempat ngecek kecamatan yang collide itu.
  it("nama kota eksplisit menang di atas kecamatan yang collide sama kelurahan lain", () => {
    expect(detectAreaFromAddress("Menteng Dalam, Tebet, South Jakarta City, Jakarta")).toBe("Kota Jakarta Selatan");
  });

  // Tapi kalau yang ambigu itu di TIER KOTA sendiri (2 kota beda eksplisit
  // disebut), jangan coba "diselamatkan" pakai kecamatan — tetap null.
  it("ambigu di tier kota TIDAK lanjut coba tier kecamatan", () => {
    expect(detectAreaFromAddress("Dari Jakarta Selatan (Menteng Dalam) pindah ke Jakarta Utara")).toBeNull();
  });

  it("singkatan dipisah spasi ('Jak Pus', 'jak sel') ikut ke-detect", () => {
    expect(detectAreaFromAddress("Kompl Ruko Mega Grosir Cempaka Mas Blok N/25 , Jak Pus")).toBe("Kota Jakarta Pusat");
    expect(detectAreaFromAddress("pondok indah, pondok pinang, keb lama, jak sel")).toBe("Kota Jakarta Selatan");
  });

  it("nama kecamatan doang (gak nyebut nama kota sama sekali) tetap ke-detect", () => {
    expect(detectAreaFromAddress("jl bisma danau blok c no 10 tanjung priok")).toBe("Kota Jakarta Utara");
    expect(detectAreaFromAddress("Kompleks Anggaran G-41, Kemanggisan Ilir RT 7 RW 1, Palmerah")).toBe("Kota Jakarta Barat");
    expect(detectAreaFromAddress("Setiabudi Residences Tower B Suite 2706")).toBe("Kota Jakarta Selatan");
  });

  it("nama kelurahan/kawasan terkenal (tier 3) — cuma dicek kalau kota & kecamatan gak nemu apa-apa", () => {
    expect(detectAreaFromAddress("apartemen green lake Sunter tower Southern unit 25 AG")).toBe("Kota Jakarta Utara");
    expect(detectAreaFromAddress("jl.pluit karang barat no 118")).toBe("Kota Jakarta Utara");
    expect(detectAreaFromAddress("Jl. Pantai Kuta 4 no 18, perumahan ancol timur")).toBe("Kota Jakarta Utara");
    expect(detectAreaFromAddress("Jl TM Bendungan Jatiluhur II no.8A Bendungan Hilir")).toBe("Kota Jakarta Pusat");
    expect(detectAreaFromAddress("jalan multi karya 1 no 2 RT 6 RW 9 kel. Utan kayu utara")).toBe("Kota Jakarta Timur");
    expect(detectAreaFromAddress("Jl. Waru no.32 Rt.02/08 Rawamangun (seberang fotocopy bintang grafika)")).toBe("Kota Jakarta Timur");
  });

  it("null/kosong -> null", () => {
    expect(detectAreaFromAddress(null)).toBeNull();
    expect(detectAreaFromAddress("")).toBeNull();
  });
});
