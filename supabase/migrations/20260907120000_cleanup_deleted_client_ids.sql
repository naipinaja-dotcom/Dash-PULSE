-- client_ids (array multi-client, ditambahin di 20260828120000) gak punya FK
-- constraint kayak client_id (ON DELETE SET NULL) — jadi kalau client dihapus
-- (admin.clients.tsx), id-nya nyangkut selamanya di array itu. Efeknya baru
-- kerasa pas admin edit & save cicilan yang kena: client_id diisi ulang dari
-- client_ids[0] yang ternyata udah gak exist -> "violates foreign key
-- constraint rider_installments_client_id_fkey".
--
-- Bersihin data yang udah kadung nyangkut, lalu tambah trigger biar delete
-- client berikutnya otomatis nyeret bersih id-nya dari client_ids juga (samain
-- perilakunya dengan ON DELETE SET NULL yang udah dipakai client_id).
UPDATE public.rider_installments
SET client_ids = NULLIF(array_remove(client_ids, missing.id), '{}')
FROM (
  SELECT DISTINCT cid AS id
  FROM public.rider_installments, unnest(client_ids) AS cid
  WHERE cid NOT IN (SELECT id FROM public.clients)
) AS missing
WHERE missing.id = ANY(client_ids);

CREATE OR REPLACE FUNCTION public.strip_deleted_client_from_installments()
RETURNS trigger AS $$
BEGIN
  UPDATE public.rider_installments
  SET client_ids = NULLIF(array_remove(client_ids, OLD.id), '{}')
  WHERE OLD.id = ANY(client_ids);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS clients_cleanup_installment_client_ids ON public.clients;
CREATE TRIGGER clients_cleanup_installment_client_ids
  BEFORE DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.strip_deleted_client_from_installments();
