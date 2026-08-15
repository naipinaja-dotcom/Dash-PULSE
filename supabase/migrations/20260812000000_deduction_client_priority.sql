-- Client prioritas per potongan: admin pilih client mana yang nanggung
-- sebuah cicilan/sewa (rider_installments) atau enrollment auto-recurring
-- restricted (deduction_type_riders, mis. BPJS JKK per rider). Null = pakai
-- client rumah rider (riders.client_id) seperti sebelumnya — jadi 100%
-- backward compatible buat baris yang udah ada.
alter table rider_installments add column client_id uuid references clients(id) on delete set null;
alter table deduction_type_riders add column client_id uuid references clients(id) on delete set null;
