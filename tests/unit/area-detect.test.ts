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
  // yang collide sama kecamatan Menteng (beda tempat, Jakpus) — 2 sinyal
  // beda, sistem BENER nolak nebak (null) daripada asal pilih salah satu.
  it("substring kecamatan yang collide sama kelurahan lain — ambigu, gak ditebak", () => {
    expect(detectAreaFromAddress("Menteng Dalam, Tebet, South Jakarta City, Jakarta")).toBeNull();
  });

  it("nama kecamatan doang (gak nyebut nama kota sama sekali) tetap ke-detect", () => {
    expect(detectAreaFromAddress("jl bisma danau blok c no 10 tanjung priok")).toBe("Kota Jakarta Utara");
    expect(detectAreaFromAddress("Kompleks Anggaran G-41, Kemanggisan Ilir RT 7 RW 1, Palmerah")).toBe("Kota Jakarta Barat");
    expect(detectAreaFromAddress("Setiabudi Residences Tower B Suite 2706")).toBe("Kota Jakarta Selatan");
  });

  it("null/kosong -> null", () => {
    expect(detectAreaFromAddress(null)).toBeNull();
    expect(detectAreaFromAddress("")).toBeNull();
  });
});
