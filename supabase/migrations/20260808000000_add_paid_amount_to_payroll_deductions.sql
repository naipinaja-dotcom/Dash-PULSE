-- Tunggakan lintas payroll: dulu kalau gross gak cukup nutup semua potongan,
-- kekurangannya cuma bikin net_pay ke-clamp 0, gak pernah kebawa/ketagih lagi
-- di periode berikutnya (lihat computeInstallmentAdvance + generatePayrollDetails
-- di payroll-generate.ts). paid_amount nyimpen berapa yang BENERAN kebayar per
-- baris potongan (diisi cuma pas Publish) — selisihnya jadi tunggakan yang
-- otomatis nempel ke tagihan periode berikutnya lewat getCarriedArrears.
alter table payroll_deductions add column paid_amount numeric;
comment on column payroll_deductions.paid_amount is 'Diisi cuma pas Publish (bukan Generate) — berapa dari amount yang bener2 kebayar. amount - paid_amount = tunggakan yang ke-bawa otomatis ke periode berikutnya. null = belum di-publish.';
