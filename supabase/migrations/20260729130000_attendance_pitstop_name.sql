-- Pitstop Name dari CSV attendance (mis. "Dark Store Alfagift - Alam Sutera")
-- gak pernah ke-simpen sebelumnya — cuma "Client Name" yang di-capture pas
-- upload. Dibutuhkan buat Reports (Ringkasan/Detail attendance) yang mau
-- di-group per pitstop, bukan cuma per client. Lihat admin.upload.tsx
-- (AttendanceUpload) buat mapping kolomnya.
alter table public.attendance_logs add column pitstop_name text;
