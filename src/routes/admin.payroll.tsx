import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";
import { usePostHog } from "@posthog/react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import {
  Plus,
  Play,
  Loader2,
  CheckCircle2,
  Send,
  Download,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Pencil,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";
import { generatePayrollDetails, computeInstallmentAdvance, DEDUCTION_PRIORITY } from "@/lib/payroll-generate";
import { allocateKasbonByRecipient } from "@/lib/kasbon-allocation";
import { triggerPayrollWorkflow } from "@/lib/api/payroll-workflow.functions";
import { IncentiveEditor } from "@/components/incentive-editor";
import {
  downloadBulkPaymentCSV,
  downloadBulkPaymentXLS,
  type BulkPaymentRow,
} from "@/lib/bulk-payment-export";
import { parseRupiah, formatRupiah, BULAN } from "@/lib/format";
import { loadApiProviders } from "@/lib/api/providers.functions";
import { resolveBusinessUnit } from "@/lib/spend-control-mapping";
import { useT } from "@/lib/i18n";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/payroll")({ component: PayrollPage });

type Run = {
  id: string;
  name: string;
  period_type: string;
  period_start: string;
  period_end: string;
  status: string;
  client_id: string | null;
};
type Client = { id: string; name: string };
type FeeAuditEntry = {
  id: string;
  action: string;
  client_id: string | null;
  scheme_name: string | null;
  period_start: string;
  period_end: string;
  row_count: number;
  total_amount: number;
  created_at: string;
  calc_table: string | null;
  affected_row_ids: string[] | null;
  rejected_at: string | null;
};
type Detail = {
  id: string;
  rider_id: string;
  client_id: string | null;
  delivery_count: number;
  delivery_fee: number;
  attendance_fee: number;
  incentive: number;
  penalty: number;
  gross_earning: number;
  total_deduction: number;
  net_pay: number;
  riders?: { full_name: string; employee_id: string };
};
type PaymentHold = {
  id: string;
  detail_id: string;
  status: "held" | "released";
  reason: string;
  payroll_follow_up_payments?: {
    id: string;
    amount: number;
    status: "ready" | "exported";
    exported_at: string | null;
  }[];
};
type Deduction = {
  id: string;
  detail_id: string;
  deduction_type_id: string | null;
  installment_id: string | null;
  description: string | null;
  amount: number;
  deduction_types?: { name: string } | null;
};
type DeductionType = { id: string; name: string };
// Kandidat netting: rider ini kekurangan gross buat nutup potongannya SENDIRI
// di run ini (shortfall), tapi punya run lain (client lain, draft, periode
// overlap) dengan sisa gross yang belum kepakai abis potongan (headroom).
type NettingCandidate = {
  detailId: string;
  riderId: string;
  riderName: string;
  employeeId: string;
  shortfall: number;
  siblingRunId: string;
  siblingRunName: string;
  siblingDetailId: string;
  headroom: number;
};

const SPEND_CONTROL_DEPARTMENTS = [
  "Customer Success",
  "Engineering Product & Design",
  "Finance",
  "Fleet",
  "Human Resources",
  "Legal",
  "Logistics",
  "Marketing",
  "Operations",
  "Sales",
];
const SPEND_CONTROL_TITLE_LIMIT = 60;
const SPEND_CONTROL_ATTACHMENT_URL = "https://dash-payroll-engine.vercel.app/admin/payroll";

type SpendControlRow = {
  clientId: string;
  clientName: string;
  title: string;
  amount: number;
  businessUnit: "SCHEDULED_INSTANT" | "X_DOCK" | null;
  contract: string | null;
  valid: boolean;
};

// Kasbon dengan penerima pihak ke-3 (kasbon_recipients, lihat add-tab.tsx)
// motong net_pay rider tapi duitnya harus BENERAN ditransfer ke rekening
// penerima itu, bukan cuma raib dari file bulk payment. Bulk Payment sudah
// bisa di-generate dari status "finalized" (SEBELUM Publish) — paid_amount
// baru keisi PAS Publish (lihat publish() di atas), jadi gak bisa dipakai di
// sini. allocateKasbonByRecipient() mereplikasi alokasi prioritas yang sama
// persis LIVE tanpa nulis apa-apa ke DB. Penerima yang ditandai
// no_transfer_needed (rekening internal perusahaan) sengaja DI-SKIP di sini
// — potongannya tetap sah, tapi gak perlu masuk file transfer bank.
async function fetchKasbonRecipientRows(payableDetails: Detail[]): Promise<BulkPaymentRow[]> {
  const detailIds = payableDetails.map((d) => d.id);
  if (detailIds.length === 0) return [];
  const grossByDetail = new Map(payableDetails.map((d) => [d.id, Number(d.gross_earning)]));
  const { data, error } = await (supabase as any)
    .from("payroll_deductions")
    .select(
      "detail_id, amount, kasbon_recipient_id, deduction_types(code), kasbon_recipients(name, bank_name, account_number, account_holder, no_transfer_needed)",
    )
    .in("detail_id", detailIds);
  if (error) throw error;

  const allocations = allocateKasbonByRecipient(grossByDetail, data ?? [], new Map());
  return allocations
    .filter((a) => !a.noTransferNeeded)
    .map((a) => ({
      bankName: a.bankName,
      accountNumber: a.accountNumber,
      receiverName: a.recipientName,
      amount: a.amount,
    }));
}

function PayrollPage() {
  const { t } = useT();
  const posthog = usePostHog();
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [details, setDetails] = useState<Detail[]>([]);
  const [paymentHolds, setPaymentHolds] = useState<Record<string, PaymentHold>>({});
  const [paymentHoldBusyId, setPaymentHoldBusyId] = useState<string | null>(null);
  const [exportingFollowUp, setExportingFollowUp] = useState(false);
  const [holdDetail, setHoldDetail] = useState<Detail | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [exportingBulk, setExportingBulk] = useState(false);
  const [deletingRun, setDeletingRun] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [feeAuditLog, setFeeAuditLog] = useState<FeeAuditEntry[]>([]);
  const [nettingCandidates, setNettingCandidates] = useState<NettingCandidate[]>([]);
  const [nettingBusyId, setNettingBusyId] = useState<string | null>(null);
  const [expandedDetailId, setExpandedDetailId] = useState<string | null>(null);
  const [deductionsByDetail, setDeductionsByDetail] = useState<Record<string, Deduction[]>>({});
  const [loadingDeductions, setLoadingDeductions] = useState(false);
  const [dTypes, setDTypes] = useState<DeductionType[]>([]);
  const [editingDeductionId, setEditingDeductionId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState(0);
  const [editDescription, setEditDescription] = useState("");
  const [editTypeId, setEditTypeId] = useState<string | null>(null);
  const [savingDeduction, setSavingDeduction] = useState(false);
  // Lock sinkron (bukan cuma state `savingDeduction`) — dobel-klik cepat di
  // "Tambah"/"Simpan" bisa nembus sebelum re-render pertama nyampein disabled
  // ke tombol, karena setState gak langsung keliatan di render yang sama.
  // Ref di sini keupdate LANGSUNG (gak nunggu re-render), jadi klik ke-2
  // dalam sepersekian detik ke-tolak jelas, bukan diam-diam bikin baris dobel.
  const savingDeductionLock = useRef(false);
  const [addingDedForDetail, setAddingDedForDetail] = useState<string | null>(null);
  const [newDedTypeId, setNewDedTypeId] = useState<string | null>(null);
  const [spendControlOpen, setSpendControlOpen] = useState(false);
  const [spendControlLoading, setSpendControlLoading] = useState(false);
  const [spendControlDept, setSpendControlDept] = useState(SPEND_CONTROL_DEPARTMENTS[0]);
  const [spendControlRows, setSpendControlRows] = useState<SpendControlRow[]>([]);
  const [newDedDescription, setNewDedDescription] = useState("");
  const [newDedAmount, setNewDedAmount] = useState(0);
  const {
    pageSize: detailPageSize,
    setPageSize: setDetailPageSize,
    page: detailPage,
    setPage: setDetailPage,
    totalPages: detailTotalPages,
    paged: pagedDetails,
    from: detailFrom,
    to: detailTo,
    total: detailTotal,
  } = usePagination(details, 20);

  const filteredRuns = runs.filter((r) =>
    showHistory ? r.status === "published" : r.status !== "published",
  );
  const {
    page: runPage,
    setPage: setRunPage,
    totalPages: runTotalPages,
    paged: pagedRuns,
  } = usePagination(filteredRuns, 5);

  const loadRuns = async () => {
    setLoading(true);
    // (supabase as any): kolom client_id belum ke-generate di types.ts sampai
    // migration 20260714000000 di-apply + `supabase gen types` dijalanin ulang.
    const { data, error } = await (supabase as any)
      .from("payroll_runs")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setRuns(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    loadRuns();
    supabase
      .from("clients")
      .select("id, name")
      .order("name")
      .then(({ data }) => setClients(data ?? []));
  }, []);

  const loadDetails = async (runId: string) => {
    const { data, error } = await supabase
      .from("payroll_details")
      .select("*, riders(full_name, employee_id)")
      .eq("run_id", runId)
      .order("net_pay", { ascending: false });
    if (error) toast.error(error.message);
    else {
      const rows = (data ?? []) as Detail[];
      setDetails(rows);
      await loadPaymentHolds(rows.map((detail) => detail.id));
    }
    // Detail lama ke-generate ulang dengan id baru tiap Generate Ulang —
    // cache expand/deduction lama jadi basi, bersihin biar gak nunjuk ke detail_id yg udah gak ada.
    setExpandedDetailId(null);
    setDeductionsByDetail({});
  };

  const loadPaymentHolds = async (detailIds: string[]) => {
    if (detailIds.length === 0) {
      setPaymentHolds({});
      return;
    }
    const { data, error } = await (supabase as any)
      .from("payroll_payment_holds")
      .select("id, detail_id, status, reason, payroll_follow_up_payments(id, amount, status, exported_at)")
      .in("detail_id", detailIds);
    if (error) {
      // Migration belum dipasang tidak boleh membuat tabel payroll lama rusak.
      if (error.code !== "42P01") toast.error(`Gagal memuat status pembayaran: ${error.message}`);
      setPaymentHolds({});
      return;
    }
    setPaymentHolds(
      Object.fromEntries(((data ?? []) as PaymentHold[]).map((hold) => [hold.detail_id, hold])),
    );
  };

  // Riwayat "Hitung Fee" (commit dari admin.calculate.tsx) yang periodenya
  // overlap sama run ini — biar admin bisa REVIEW client mana aja yang udah
  // dihitung sebelum Generate/Finalize, bukan cuma andalin toast sekali doang.
  // Kalau run ini scoped ke 1 client (client_id keisi), filter juga per client
  // itu — run "Semua Client" (client_id null) tetap nampilin semua.
  const loadFeeAuditLog = async (run: Run) => {
    let q = (supabase as any)
      .from("fee_calculation_audit_log")
      .select(
        "id, action, client_id, scheme_name, period_start, period_end, row_count, total_amount, created_at, calc_table, affected_row_ids, rejected_at",
      )
      .lte("period_start", run.period_end)
      .gte("period_end", run.period_start)
      .order("created_at", { ascending: false });
    if (run.client_id) q = q.eq("client_id", run.client_id);
    const { data, error } = await q;
    if (error) {
      toast.error(`Gagal muat riwayat hitung fee: ${error.message}`);
      return;
    }
    setFeeAuditLog(data ?? []);
  };

  // Cari rider yang potongannya di run INI lebih besar dari gross-nya di sini
  // (shortfall — net ke-clamp 0, kelebihan potongan ilang gitu aja tanpa ini),
  // TAPI rider itu juga punya run lain (client lain, masih draft, periode
  // overlap) yang gross-nya masih ada sisa setelah potongannya sendiri
  // (headroom) — kandidat buat "netting" kekurangan itu ke run lain itu.
  // Cuma nyentuh run berstatus draft (never finalized/published) biar gak
  // ganggu run yang udah settel.
  const checkNettingCandidates = async (run: Run) => {
    // total_deduction/gross_earning numeric dari Supabase balik sebagai STRING
    // — `>` mentah di string itu perbandingan leksikografik (per-karakter),
    // bukan angka (mis. "9000" dianggap "lebih besar" dari "15000" karena '9'
    // > '1' di karakter pertama). Number() wajib sebelum dibandingkan/dikurangi
    // di seluruh fungsi ini biar netting nunjuk rider yang bener.
    const shortfallRows = details.filter((d) => Number(d.total_deduction) > Number(d.gross_earning));
    if (!shortfallRows.length) return setNettingCandidates([]);
    const riderIds = shortfallRows.map((d) => d.rider_id);

    const { data: siblingDetails } = await (supabase as any)
      .from("payroll_details")
      .select(
        "id, rider_id, run_id, gross_earning, total_deduction, payroll_runs!inner(id, name, status, client_id, period_start, period_end)",
      )
      .in("rider_id", riderIds)
      .neq("run_id", run.id)
      .eq("payroll_runs.status", "draft")
      .lte("payroll_runs.period_start", run.period_end)
      .gte("payroll_runs.period_end", run.period_start);
    if (!siblingDetails?.length) return setNettingCandidates([]);

    const candidates: NettingCandidate[] = [];
    for (const d of shortfallRows) {
      const shortfall = Number(d.total_deduction) - Number(d.gross_earning);
      const sib = (siblingDetails as any[])
        .filter((s) => s.rider_id === d.rider_id && Number(s.gross_earning) - Number(s.total_deduction) > 0)
        .sort(
          (a, b) =>
            (Number(b.gross_earning) - Number(b.total_deduction)) -
            (Number(a.gross_earning) - Number(a.total_deduction)),
        )[0];
      if (!sib) continue;
      candidates.push({
        detailId: d.id,
        riderId: d.rider_id,
        riderName: d.riders?.full_name ?? "(tanpa nama)",
        employeeId: d.riders?.employee_id ?? "",
        shortfall,
        siblingRunId: sib.run_id,
        siblingRunName: sib.payroll_runs.name,
        siblingDetailId: sib.id,
        headroom: Number(sib.gross_earning) - Number(sib.total_deduction),
      });
    }
    setNettingCandidates(candidates);
  };

  useEffect(() => {
    if (activeRun) {
      loadDetails(activeRun.id);
      loadFeeAuditLog(activeRun);
    }
  }, [activeRun]);

  useEffect(() => {
    if (activeRun && details.length) checkNettingCandidates(activeRun);
    else setNettingCandidates([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun, details]);

  // Pindahin kekurangan potongan rider ini ke run client lain yang masih ada
  // sisa gross-nya (lihat checkNettingCandidates). Skala-turunin baris
  // payroll_deductions di run asal secara proporsional sampai totalnya pas
  // sama gross (net_pay = 0, bukan minus), lalu titip sisa kekurangannya
  // sebagai 1 baris deduction baru (installment_id/deduction_type_id null —
  // gak nyentuh progress cicilan manapun) di run tujuan.
  // PENTING: kalau salah satu run di-"Generate Ulang" setelah ini, hasil
  // netting-nya IKUT KEHAPUS (payroll_details/payroll_deductions dibikin
  // ulang dari nol) — perlu netting ulang.
  const applyNetting = async (c: NettingCandidate) => {
    setNettingBusyId(c.detailId);
    try {
      const amount = Math.min(c.shortfall, c.headroom);
      const { data: rows, error: e1 } = await (supabase as any)
        .from("payroll_deductions")
        .select("id, amount")
        .eq("detail_id", c.detailId);
      if (e1) throw e1;
      const oldTotal = (rows ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
      if (oldTotal > 0) {
        const ratio = Math.max(0, oldTotal - amount) / oldTotal;
        for (const r of (rows ?? []) as any[]) {
          const { error } = await (supabase as any)
            .from("payroll_deductions")
            .update({ amount: Math.round(Number(r.amount) * ratio) })
            .eq("id", r.id);
          if (error) throw error;
        }
      }
      const origin = details.find((d) => d.id === c.detailId);
      const newTotalDed = Math.max(0, (origin?.total_deduction ?? amount) - amount);
      const { error: e2 } = await (supabase as any)
        .from("payroll_details")
        .update({
          total_deduction: newTotalDed,
          net_pay: Math.max(0, (origin?.gross_earning ?? 0) - newTotalDed),
        })
        .eq("id", c.detailId);
      if (e2) throw e2;

      const { error: e3 } = await (supabase as any).from("payroll_deductions").insert({
        detail_id: c.siblingDetailId,
        deduction_type_id: null,
        installment_id: null,
        description: `Titipan potongan dari ${activeRun?.name ?? "run lain"} (rider kurang gross di client asal)`,
        amount,
      });
      if (e3) throw e3;
      const { data: sibDetail } = await (supabase as any)
        .from("payroll_details")
        .select("gross_earning, total_deduction")
        .eq("id", c.siblingDetailId)
        .single();
      const sibNewTotalDed = Number(sibDetail?.total_deduction ?? 0) + amount;
      const { error: e4 } = await (supabase as any)
        .from("payroll_details")
        .update({
          total_deduction: sibNewTotalDed,
          net_pay: Math.max(0, Number(sibDetail?.gross_earning ?? 0) - sibNewTotalDed),
        })
        .eq("id", c.siblingDetailId);
      if (e4) throw e4;

      toast.success(
        `Rp${amount.toLocaleString("id-ID")} potongan ${c.riderName} dipindah ke ${c.siblingRunName}`,
      );
      if (activeRun) loadDetails(activeRun.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setNettingBusyId(null);
    }
  };

  // Buka/tutup rincian potongan 1 rider (payroll_deductions per detail_id).
  // Di-fetch on-demand & di-cache, karena tabel detail bisa banyak baris dan
  // gak semua bakal dibuka adminnya.
  const toggleDeductions = async (detailId: string) => {
    if (expandedDetailId === detailId) {
      setExpandedDetailId(null);
      return;
    }
    setExpandedDetailId(detailId);
    setEditingDeductionId(null);
    if (deductionsByDetail[detailId]) return;
    setLoadingDeductions(true);
    const { data, error } = await supabase
      .from("payroll_deductions")
      .select("*, deduction_types(name)")
      .eq("detail_id", detailId)
      .order("created_at");
    setLoadingDeductions(false);
    if (error) return toast.error(error.message);
    setDeductionsByDetail((prev) => ({ ...prev, [detailId]: (data ?? []) as any }));
    if (dTypes.length === 0) {
      const { data: types } = await (supabase as any)
        .from("deduction_types")
        .select("id, name")
        .eq("active", true);
      setDTypes(types ?? []);
    }
  };

  const startEditDeduction = (d: Deduction) => {
    setEditingDeductionId(d.id);
    setEditAmount(d.amount);
    setEditDescription(d.description ?? "");
    setEditTypeId(d.deduction_type_id);
  };

  // Habis 1 baris payroll_deductions ditambah/diedit, total_deduction/net_pay
  // di payroll_details induknya HARUS direcompute & disimpen ulang (PRD §9.1:
  // amount numpang ke situ) — satu tempat dipakai saveDeductionEdit & addDeduction.
  const applyDeductionListChange = async (detailId: string, list: Deduction[]) => {
    const newTotalDed = list.reduce((s, x) => s + Number(x.amount), 0);
    const detail = details.find((x) => x.id === detailId);
    if (!detail) throw new Error("Detail payroll tidak ditemukan di halaman ini — refresh dulu.");
    const newNet = Math.max(0, detail.gross_earning - newTotalDed);
    const { error } = await supabase
      .from("payroll_details")
      .update({ total_deduction: newTotalDed, net_pay: newNet })
      .eq("id", detailId);
    if (error) throw error;
    setDeductionsByDetail((prev) => ({ ...prev, [detailId]: list }));
    setDetails((prev) =>
      prev.map((x) => (x.id === detailId ? { ...x, total_deduction: newTotalDed, net_pay: newNet } : x)),
    );
  };

  // Koreksi 1 baris potongan yang udah ke-generate ke payroll run. Gak ada
  // mekanisme buat "melindungi" edit manual ini dari Generate Ulang (yang
  // selalu hapus-total & bikin ulang semua detail+deduction dari nol) —
  // makanya di-warning eksplisit di toast, bukan diam-diam ketimpa nanti.
  const saveDeductionEdit = async (d: Deduction) => {
    if (!activeRun) return;
    if (savingDeductionLock.current) return toast.error("Masih memproses permintaan sebelumnya, tunggu sebentar.");
    savingDeductionLock.current = true;
    setSavingDeduction(true);
    try {
      const { error: e1 } = await supabase
        .from("payroll_deductions")
        .update({
          amount: editAmount,
          description: editDescription.trim() || null,
          deduction_type_id: editTypeId,
        })
        .eq("id", d.id);
      if (e1) throw e1;

      const list = (deductionsByDetail[d.detail_id] ?? []).map((x) =>
        x.id === d.id
          ? {
              ...x,
              amount: editAmount,
              description: editDescription.trim() || null,
              deduction_type_id: editTypeId,
            }
          : x,
      );
      await applyDeductionListChange(d.detail_id, list);
      setEditingDeductionId(null);
      posthog.capture("payroll_deduction_edited", {
        run_id: activeRun.id,
        detail_id: d.detail_id,
        deduction_id: d.id,
      });
      toast.success(
        'Potongan diperbarui. Ingat: kalau nanti "Generate Ulang" dijalankan, angka ini kehitung ulang dari cicilan/potongan-otomatis dan perubahan manual ini hilang.',
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingDeduction(false);
      savingDeductionLock.current = false;
    }
  };

  // Potongan ad-hoc di luar cicilan/potongan-otomatis (mis. kasbon dadakan
  // yang belum sempat dicatat lewat Cicilan Aktif) — pola sama persis kayak
  // IncentiveEditor: gak nunjuk ke installment_id, dan cuma boleh selama run
  // masih draft (sama kayak edit potongan lain di atas) biar gak numpuk sama
  // risiko Generate Ulang/publish yang udah di-warning di tempat lain.
  const addDeduction = async (detailId: string) => {
    if (savingDeductionLock.current) return toast.error("Masih memproses permintaan sebelumnya, tunggu sebentar.");
    if (!newDedDescription.trim()) return toast.error("Keterangan wajib diisi");
    if (newDedAmount <= 0) return toast.error("Jumlah harus lebih dari 0");
    savingDeductionLock.current = true;
    setSavingDeduction(true);
    try {
      const { data, error: e1 } = await supabase
        .from("payroll_deductions")
        .insert({
          detail_id: detailId,
          deduction_type_id: newDedTypeId,
          installment_id: null,
          description: newDedDescription.trim(),
          amount: newDedAmount,
        })
        .select("*, deduction_types(name)")
        .single();
      if (e1) throw e1;

      const list = [...(deductionsByDetail[detailId] ?? []), data as Deduction];
      await applyDeductionListChange(detailId, list);
      posthog.capture("payroll_deduction_added", { run_id: activeRun?.id, detail_id: detailId });
      toast.success(
        'Potongan ditambahkan. Ingat: kalau nanti "Generate Ulang" dijalankan, baris ini ikut kehapus (gak nempel ke cicilan/potongan-otomatis manapun).',
      );
      setAddingDedForDetail(null);
      setNewDedTypeId(null);
      setNewDedDescription("");
      setNewDedAmount(0);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingDeduction(false);
      savingDeductionLock.current = false;
    }
  };

  // Reject: salah pilih tanggal/client, udah keburu commit — reset PERSIS
  // baris yang kena commit itu (affected_row_ids) balik ke fee=0, dan tandain
  // entry-nya rejected biar gak dipakai lagi buat "Buat Run". Cuma untuk
  // action "commit_payroll" (commit_invoice beda mekanisme — insert row baru
  // di invoice_details, bukan update fee, jadi di luar scope reject ini).
  const rejectCalculation = async (entry: FeeAuditEntry) => {
    if (entry.action !== "commit_payroll" || !entry.calc_table || !entry.affected_row_ids?.length) {
      return toast.error(
        "Entry ini gak bisa di-reject (bukan commit fee, atau data baris kena-nya gak lengkap).",
      );
    }
    if (
      !(await confirmDialog({
        title: "Reject hasil Hitung Fee ini?",
        description: `${entry.row_count} baris yang kena commit ini akan dikembalikan ke fee = 0. Pastikan belum ada Payroll Run yang di-Finalize/Publish dari data ini — reject TIDAK otomatis mengoreksi run yang sudah kebentuk.`,
        confirmText: "Reject",
        danger: true,
      }))
    )
      return;
    try {
      const ids = entry.affected_row_ids;
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const { error } = await (supabase as any)
          .from(entry.calc_table)
          .update({ fee: 0 })
          .in("id", chunk);
        if (error) throw error;
      }
      const { error: markErr } = await (supabase as any)
        .from("fee_calculation_audit_log")
        .update({
          rejected_at: new Date().toISOString(),
          rejected_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        })
        .eq("id", entry.id);
      if (markErr) throw markErr;
      toast.success(
        `${ids.length} baris di-reset ke fee = 0. Hitung ulang lewat Hitung Fee kalau perlu.`,
      );
      if (activeRun) loadFeeAuditLog(activeRun);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Hapus baris riwayat — CUMA catatan auditnya yang kehapus, gak nyentuh fee
  // yang udah tersimpan (itu urusan Reject di atas). Buat beresin tampilan
  // yang numpuk (dobel-submit lama, percobaan periode yang salah, dll).
  const deleteAuditEntry = async (entry: FeeAuditEntry) => {
    if (
      !(await confirmDialog({
        title: "Hapus riwayat Hitung Fee ini?",
        description: entry.rejected_at
          ? "Baris yang udah di-reject ini cuma dihapus dari tampilan riwayat — fee yang udah di-reset ke 0 tetap aman. Gak bisa dibatalkan."
          : "Cuma catatan riwayatnya yang kehapus — fee yang udah tersimpan TIDAK ikut ke-reset (kalau mau itu, pakai Reject dulu, baru hapus). Gak bisa dibatalkan.",
        confirmText: "Hapus",
        danger: true,
      }))
    )
      return;
    const { error } = await (supabase as any)
      .from("fee_calculation_audit_log")
      .delete()
      .eq("id", entry.id);
    if (error) return toast.error(error.message);
    toast.success("Riwayat dihapus");
    if (activeRun) loadFeeAuditLog(activeRun);
  };

  // "Generate Ulang" manual — dipakai kalau ada data yang berubah setelah run
  // ke-generate (mis. upload attendance baru, deduction ditambah) dan admin
  // mau recompute tanpa lewat Hitung Fee lagi. Pembuatan run itu sendiri
  // sekarang OTOMATIS (lihat commit() di admin.calculate.tsx — reuse
  // generatePayrollDetails() yang sama).
  const generate = async () => {
    if (!activeRun) return;
    // Run yang udah "published" berarti slip gaji UDAH dikirim dan paid_amount
    // per potongan UDAH tercatat (dipakai buat ngitung tunggakan periode
    // berikutnya, lihat getCarriedArrears di payroll-generate.ts). Generate
    // Ulang di sini bakal ngehapus catatan paid_amount itu — tunggakan rider
    // bisa ke-hitung dobel atau malah hilang di periode selanjutnya. Warning
    // eksplisit sebelum boleh lanjut, bukan sekadar disable, biar admin masih
    // bisa forsir kalau memang tau risikonya (mis. run itu salah total).
    if (activeRun.status === "published") {
      if (
        !(await confirmDialog({
          title: "Periode & client ini SUDAH di-publish",
          description:
            "Slip gaji udah terbit dan catatan pembayaran potongan (dipakai buat hitung tunggakan periode berikutnya) bakal ke-reset. Kalau ada rider yang lagi nunggak dari run ini, tunggakannya bisa ke-hitung dobel atau hilang. Lanjut cuma kalau kamu yakin run ini emang salah dan perlu diulang total.",
          confirmText: "Saya paham risikonya, generate ulang",
          danger: true,
        }))
      )
        return;
    } else if (
      !(await confirmDialog({
        title: "Generate ulang payroll?",
        description: "Detail payroll yang lama untuk run ini akan dihapus dan dihitung ulang.",
        confirmText: "Generate ulang",
        danger: false,
      }))
    )
      return;
    setLoading(true);
    try {
      const { detailCount } = await generatePayrollDetails(activeRun);
      posthog.capture("payroll_generated", {
        run_id: activeRun.id,
        client_id: activeRun.client_id,
        detail_count: detailCount,
      });
      toast.success(`Generate ${detailCount} detail`);
      loadDetails(activeRun.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const finalize = async () => {
    if (!activeRun) return;
    setFinalizing(true);
    const { error } = await supabase
      .from("payroll_runs")
      .update({ status: "finalized", finalized_at: new Date().toISOString() })
      .eq("id", activeRun.id);
    setFinalizing(false);
    if (error) return toast.error(error.message);
    setActiveRun((current) =>
      current?.id === activeRun.id
        ? { ...current, status: "finalized" }
        : current,
    );
    posthog.capture("payroll_run_finalized", {
      run_id: activeRun.id,
      client_id: activeRun.client_id,
    });
    toast.success("Payroll difinalisasi");
    loadRuns();
  };

  const publish = async () => {
    if (!activeRun) return;
    setPublishing(true);
    try {
      // create payslips
      const { data: dets } = await supabase
        .from("payroll_details")
        .select("*")
        .eq("run_id", activeRun.id);
      if (!dets?.length) return toast.error("Belum ada detail");
      const slips = dets.map((d: any) => ({
        detail_id: d.id,
        run_id: activeRun.id,
        rider_id: d.rider_id,
        data: d,
      }));
      const { error: e1 } = await supabase
        .from("payslips")
        .upsert(slips, { onConflict: "detail_id" });
      if (e1) return toast.error(e1.message);
      // Alokasi gross_earning tiap detail ke potongan-potongannya sesuai
      // prioritas (Admin > BPJS > Kerusakan Barang > Kasbon > Sewa Molis >
      // Pinjaman Kuota) — kalau gross gak cukup, prioritas rendah yang kena
      // kurang duluan. paid_amount per baris dicatat di sini (cuma pas
      // Publish), selisihnya otomatis ketagih lagi periode berikutnya lewat
      // getCarriedArrears di payroll-generate.ts.
      const grossByDetail = new Map<string, number>(dets.map((d: any) => [d.id, Number(d.gross_earning)]));
      const { data: deds } = await supabase
        .from("payroll_deductions")
        .select("id, detail_id, installment_id, amount, deduction_types(code)")
        .in("detail_id", dets.map((d: any) => d.id));

      const byDetail = new Map<string, any[]>();
      for (const d of (deds ?? []) as any[]) {
        const arr = byDetail.get(d.detail_id) ?? [];
        arr.push(d);
        byDetail.set(d.detail_id, arr);
      }

      for (const [detailId, rows] of byDetail) {
        let remaining = grossByDetail.get(detailId) ?? 0;
        const sorted = [...(rows ?? [])].sort(
          (a: any, b: any) =>
            (DEDUCTION_PRIORITY[a.deduction_types?.code] ?? 99) - (DEDUCTION_PRIORITY[b.deduction_types?.code] ?? 99),
        );
        for (const row of sorted as any[]) {
          const amount = Number(row.amount);
          const paid = Math.max(0, Math.min(remaining, amount));
          remaining -= paid;
          await supabase.from("payroll_deductions").update({ paid_amount: paid }).eq("id", row.id);
          if (!row.installment_id) continue;
          const { data: ins } = await supabase
            .from("rider_installments")
            .select("*")
            .eq("id", row.installment_id)
            .single();
          if (!ins) continue;
          const advance = computeInstallmentAdvance(ins, paid >= amount);
          if (!advance) continue;
          await supabase.from("rider_installments").update(advance).eq("id", ins.id);
        }
      }
      const { error: e2 } = await supabase
        .from("payroll_runs")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", activeRun.id);
      if (e2) return toast.error(e2.message);
      setActiveRun((current) =>
        current?.id === activeRun.id
          ? { ...current, status: "published" }
          : current,
      );
      posthog.capture("payroll_run_published", {
        run_id: activeRun.id,
        client_id: activeRun.client_id,
        slip_count: slips.length,
      });
      toast.success(`Publish ${slips.length} slip gaji`);
      loadRuns();
    } finally {
      setPublishing(false);
    }
  };

  // Hapus run yang salah komit (mis. salah pilih client/tanggal) sebelum
  // sempat di-Finalize. Cuma untuk status "draft" — begitu Finalize/Publish,
  // run dianggap sudah jadi checkpoint resmi dan gak boleh dihapus lagi.
  // Cascade DB (payroll_details.run_id, payroll_deductions.detail_id,
  // payslips.run_id/detail_id) beresin detail/deduction-nya otomatis. Ini
  // TIDAK membatalkan fee yang sudah ke-commit di delivery_records/
  // attendance_logs — fee itu tetap ada dan akan muncul lagi di run baru
  // begitu di-Hitung Fee / Generate Ulang, makanya di-warning eksplisit.
  const deleteRun = async () => {
    if (!activeRun || activeRun.status !== "draft") return;
    if (
      !(await confirmDialog({
        title: "Hapus payroll run ini?",
        description:
          "Detail, potongan, dan riwayat terkait run ini akan ikut terhapus. Fee yang sudah di-commit ke data pengiriman/absensi TIDAK ikut dibatalkan — akan muncul lagi kalau kamu Hitung Fee / Generate Ulang untuk periode & client yang sama.",
        confirmText: "Hapus Run",
        danger: true,
      }))
    )
      return;
    setDeletingRun(true);
    const { error } = await supabase.from("payroll_runs").delete().eq("id", activeRun.id);
    setDeletingRun(false);
    if (error) return toast.error(error.message);
    posthog.capture("payroll_run_deleted", {
      run_id: activeRun.id,
      client_id: activeRun.client_id,
    });
    toast.success("Payroll run dihapus");
    setActiveRun(null);
    loadRuns();
  };

  // Hapus MASSAL draft run yang KOSONG (tanpa detail rider) — biasanya run yang
  // kebuat otomatis oleh workflow buat client yang belum ada aktivitas/jadwal.
  // Cuma sentuh status draft & yang benar-benar 0 detail, jadi run yang ada
  // datanya (fee sudah masuk) TIDAK ikut terhapus.
  const [deletingBulk, setDeletingBulk] = useState(false);
  const deleteEmptyDrafts = async () => {
    const drafts = runs.filter((r) => r.status === "draft");
    if (drafts.length === 0) return toast.message("Tidak ada draft run.");
    const draftIds = drafts.map((r) => r.id);
    // run mana yang PUNYA detail?
    const { data: withDetails, error: dErr } = await (supabase as any)
      .from("payroll_details")
      .select("run_id")
      .in("run_id", draftIds);
    if (dErr) return toast.error(dErr.message);
    const hasDetails = new Set((withDetails ?? []).map((d: any) => d.run_id));
    const empties = drafts.filter((r) => !hasDetails.has(r.id));
    if (empties.length === 0) return toast.message("Tidak ada draft run kosong untuk dihapus.");
    if (
      !(await confirmDialog({
        title: `Hapus ${empties.length} draft run kosong?`,
        description: `${empties.length} payroll run berstatus draft yang belum ada detail rider (kemungkinan dibuat otomatis oleh workflow untuk client tanpa aktivitas/jadwal) akan dihapus. Run yang sudah ada datanya tidak terpengaruh.`,
        confirmText: "Hapus Semua",
        danger: true,
      }))
    )
      return;
    setDeletingBulk(true);
    const { error } = await (supabase as any)
      .from("payroll_runs")
      .delete()
      .in(
        "id",
        empties.map((r) => r.id),
      );
    setDeletingBulk(false);
    if (error) return toast.error(error.message);
    posthog.capture("payroll_empty_drafts_deleted", { count: empties.length });
    toast.success(`${empties.length} draft run kosong dihapus.`);
    if (activeRun && empties.some((r) => r.id === activeRun.id)) setActiveRun(null);
    loadRuns();
  };

  // Jalankan Payroll Workflow manual (sama dgn cron): tiap client berjadwal yg
  // jatuh tempo → tarik data live API (kalau ter-map) → hitung → buat/isi run.
  const [runningWorkflow, setRunningWorkflow] = useState(false);
  const runWorkflowNow = async () => {
    if (
      !(await confirmDialog({
        title: "Jalankan Payroll Workflow sekarang?",
        description:
          "Semua client BERJADWAL yang periodenya jatuh tempo hari ini akan diproses: tarik data live dari API (untuk client yang ter-map) → hitung fee → buat/isi Payroll Run. Sama seperti yang dijalankan cron otomatis.",
        confirmText: "Jalankan",
        danger: false,
      }))
    )
      return;
    setRunningWorkflow(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const adminToken = sess.session?.access_token ?? "";
      const res = await triggerPayrollWorkflow({ data: { adminToken } });
      toast.success(
        `Workflow selesai: ${res.runsProcessed} run diproses` +
          (res.skipped ? `, ${res.skipped} dilewati` : "") +
          ".",
      );
      loadRuns();
    } catch (e) {
      toast.error(`Workflow gagal: ${(e as Error).message}`);
    } finally {
      setRunningWorkflow(false);
    }
  };

  // Bulk payment — file transfer bank buat Finance, format ngikutin persis
  // template yang udah dipakai (lihat src/lib/bulk-payment-export.ts).
  // Data bank rider (bank_name/bank_account/bank_account_holder) sengaja
  // di-fetch on-demand di sini, bukan ditaruh di query list utama, biar gak
  // nempel terus di state layar (data rekening termasuk sensitif).
  const exportBulkPayment = async (format: "csv" | "xls") => {
    if (!activeRun || details.length === 0)
      return toast.error("Belum ada detail payroll untuk run ini");
    setExportingBulk(true);
    try {
      // Rider yang pernah di-hold tetap selalu keluar dari bulk reguler,
      // termasuk setelah release. Release membuat payout susulan sendiri,
      // jadi tidak mungkin terbayar dua kali dari file reguler.
      const payableDetails = details.filter((detail) => !paymentHolds[detail.id]);
      const heldCount = details.length - payableDetails.length;
      if (payableDetails.length === 0)
        return toast.error("Semua rider pada run ini sedang/sempat ditahan. Gunakan pembayaran susulan setelah hold dilepas.");
      const riderIds = [...new Set(payableDetails.map((d) => d.rider_id))];
      const { data: bankData, error } = await (supabase as any)
        .from("riders")
        .select("id, full_name, bank_name, bank_account, bank_account_holder")
        .in("id", riderIds);
      if (error) throw error;
      const bankOf = new Map((bankData ?? []).map((r: any) => [r.id, r]));

      // Gabung per rider (jaga-jaga kalau 1 rider punya >1 baris detail di run yang sama)
      const byRider = new Map<string, number>();
      for (const d of payableDetails)
        byRider.set(d.rider_id, (byRider.get(d.rider_id) ?? 0) + Number(d.net_pay || 0));

      const rows: BulkPaymentRow[] = [];
      const missingBank: string[] = [];
      for (const [riderId, amount] of byRider) {
        if (amount <= 0) continue; // gak perlu transfer kalau net pay 0/negatif
        const r = bankOf.get(riderId) as
          | {
              full_name?: string;
              bank_name?: string | null;
              bank_account?: string | null;
              bank_account_holder?: string | null;
            }
          | undefined;
        if (!r?.bank_name || !r?.bank_account) {
          missingBank.push(r?.full_name ?? riderId);
          continue;
        }
        rows.push({
          bankName: r.bank_name,
          accountNumber: r.bank_account,
          receiverName: r.bank_account_holder || r.full_name || "",
          amount,
        });
      }

      if (missingBank.length > 0) {
        toast.warning(
          `${missingBank.length} rider dilewati (belum ada data bank): ${missingBank.slice(0, 5).join(", ")}${missingBank.length > 5 ? ", ..." : ""}`,
        );
      }

      const kasbonRows = await fetchKasbonRecipientRows(payableDetails);
      rows.push(...kasbonRows);

      if (rows.length === 0)
        return toast.error("Tidak ada rider dengan data bank lengkap untuk di-export");

      const filename = `Bulk Payment - ${activeRun.name} - ${activeRun.period_end}`;
      if (format === "csv") downloadBulkPaymentCSV(filename, rows);
      else downloadBulkPaymentXLS(filename, rows);
      toast.success(
        `Bulk payment ${rows.length} rider berhasil di-generate` +
          (kasbonRows.length ? `, termasuk ${kasbonRows.length} transfer ke penerima kasbon` : "") +
          (heldCount ? `; ${heldCount} detail hold dikeluarkan dari file reguler.` : ""),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExportingBulk(false);
    }
  };

  // Fase 1: hanya preview. Pengiriman ke API Spend Control baru boleh
  // diaktifkan setelah endpoint dan service account resmi tersedia.
  const openSpendControlPreview = async () => {
    if (!activeRun || details.length === 0)
      return toast.error("Belum ada detail payroll untuk run ini");
    setSpendControlOpen(true);
    setSpendControlLoading(true);
    try {
      // Samakan populasi request dengan Bulk Payment reguler: detail yang
      // pernah di-hold dibayar lewat mekanisme susulan; net pay nol/negatif
      // bukan pembayaran yang dapat diajukan.
      const payableDetails = details.filter(
        (detail) => !paymentHolds[detail.id] && Number(detail.net_pay || 0) > 0,
      );
      const byClient = new Map<string, number>();
      for (const detail of payableDetails) {
        if (!detail.client_id) continue;
        byClient.set(detail.client_id, (byClient.get(detail.client_id) ?? 0) + Number(detail.net_pay || 0));
      }
      const clientIds = [...byClient.keys()];
      if (clientIds.length === 0) {
        setSpendControlRows([]);
        return;
      }

      const { data: clientRows, error } = await (supabase as any)
        .from("clients")
        .select("id, name, contract, provider_id")
        .in("id", clientIds);
      if (error) throw error;

      let businessUnitByProviderId = new Map<number, "SCHEDULED_INSTANT" | "X_DOCK" | null>();
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        if (token) {
          const { providers } = await loadApiProviders({ data: { token } });
          businessUnitByProviderId = new Map(
            providers.map((provider) => [provider.id, resolveBusinessUnit(provider.revenueStreams)]),
          );
        }
      } catch {
        // Preview tetap bisa dibuka; provider tanpa data ditandai untuk diisi.
      }

      const end = new Date(`${activeRun.period_end}T00:00:00Z`);
      const startDay = new Date(`${activeRun.period_start}T00:00:00Z`).getUTCDate();
      const period = `${startDay}-${end.getUTCDate()} ${BULAN[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
      const rows: SpendControlRow[] = clientIds.map((clientId) => {
        const client = (clientRows ?? []).find((row: any) => row.id === clientId);
        const clientName = client?.name ?? "(client tidak ditemukan)";
        const businessUnit = client?.provider_id != null
          ? businessUnitByProviderId.get(client.provider_id) ?? null
          : null;
        const contract = client?.contract ?? null;
        return {
          clientId,
          clientName,
          title: `Payroll Gaji Mitra - ${clientName} (${period})`,
          amount: byClient.get(clientId) ?? 0,
          businessUnit,
          contract,
          valid: businessUnit !== null && contract !== null,
        };
      });
      rows.sort((a, b) => a.clientName.localeCompare(b.clientName));
      setSpendControlRows(rows);
    } catch (error) {
      toast.error((error as Error).message);
      setSpendControlOpen(false);
    } finally {
      setSpendControlLoading(false);
    }
  };

  const holdPayment = async (detail: Detail, reason: string) => {
    if (!activeRun || activeRun.status === "draft") {
      toast.error("Finalize payroll dulu sebelum menahan pembayaran.");
      return;
    }
    if (!reason.trim()) return toast.error("Alasan hold wajib diisi.");

    setPaymentHoldBusyId(detail.id);
    try {
      const { error } = await (supabase as any).from("payroll_payment_holds").insert({
        detail_id: detail.id,
        rider_id: detail.rider_id,
        reason: reason.trim(),
      });
      if (error) throw error;
      posthog.capture("payroll_payment_held", { run_id: activeRun.id, detail_id: detail.id });
      toast.success("Pembayaran ditahan. Rider tidak akan masuk bulk payment reguler.");
      setHoldDetail(null);
      setHoldReason("");
      await loadPaymentHolds(details.map((row) => row.id));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPaymentHoldBusyId(null);
    }
  };

  const releasePaymentHold = async (hold: PaymentHold) => {
    if (!activeRun) return;
    if (
      !(await confirmDialog({
        title: "Lepaskan hold pembayaran?",
        description:
          "Sistem akan membuat antrean pembayaran susulan sebesar net pay pada payroll asli. Rider tetap tidak masuk bulk payment reguler.",
        confirmText: "Buat Pembayaran Susulan",
        danger: false,
      }))
    )
      return;
    setPaymentHoldBusyId(hold.detail_id);
    try {
      const { error } = await (supabase as any).rpc("release_held_payroll_payment", {
        p_hold_id: hold.id,
      });
      if (error) throw error;
      posthog.capture("payroll_payment_hold_released", {
        run_id: activeRun.id,
        detail_id: hold.detail_id,
      });
      toast.success("Hold dilepas. Pembayaran susulan siap diexport.");
      await loadPaymentHolds(details.map((row) => row.id));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPaymentHoldBusyId(null);
    }
  };

  const exportFollowUpPayment = async (format: "csv" | "xls") => {
    if (!activeRun) return;
    const readyPayments = Object.values(paymentHolds).flatMap((hold) =>
      (hold.payroll_follow_up_payments ?? [])
        .filter((payment) => payment.status === "ready")
        .map((payment) => ({ ...payment, riderId: details.find((detail) => detail.id === hold.detail_id)?.rider_id })),
    ).filter((payment): payment is { id: string; amount: number; status: "ready"; exported_at: string | null; riderId: string } => !!payment.riderId);

    if (readyPayments.length === 0)
      return toast.message("Belum ada pembayaran susulan yang siap diexport untuk payroll ini.");

    setExportingFollowUp(true);
    try {
      const riderIds = [...new Set(readyPayments.map((payment) => payment.riderId))];
      const { data: bankData, error } = await (supabase as any)
        .from("riders")
        .select("id, full_name, bank_name, bank_account, bank_account_holder")
        .in("id", riderIds);
      if (error) throw error;
      const bankOf = new Map((bankData ?? []).map((r: any) => [r.id, r]));
      const rows: BulkPaymentRow[] = [];
      const exportIds: string[] = [];
      const missingBank: string[] = [];
      for (const payment of readyPayments) {
        const rider = bankOf.get(payment.riderId) as any;
        if (!rider?.bank_name || !rider?.bank_account) {
          missingBank.push(rider?.full_name ?? payment.riderId);
          continue;
        }
        rows.push({
          bankName: rider.bank_name,
          accountNumber: rider.bank_account,
          receiverName: rider.bank_account_holder || rider.full_name || "",
          amount: Number(payment.amount),
        });
        exportIds.push(payment.id);
      }
      if (missingBank.length) {
        toast.warning(`${missingBank.length} rider susulan dilewati karena data bank belum lengkap.`);
      }

      // Detail yang di-hold gak pernah masuk bulk payment reguler sama sekali
      // (termasuk potongan kasbonnya) — jadi penerima kasbon rider ini juga
      // baru bisa ditransfer dari sini, pas hold-nya dilepas.
      const readyDetailIds = Object.values(paymentHolds)
        .filter((hold) => (hold.payroll_follow_up_payments ?? []).some((p) => p.status === "ready"))
        .map((hold) => hold.detail_id);
      const kasbonRows = await fetchKasbonRecipientRows(details.filter((d) => readyDetailIds.includes(d.id)));
      rows.push(...kasbonRows);

      if (rows.length === 0) return toast.error("Tidak ada pembayaran susulan dengan data bank lengkap.");

      const filename = `Pembayaran Susulan - ${activeRun.name} - ${activeRun.period_end}`;
      if (format === "csv") downloadBulkPaymentCSV(filename, rows);
      else downloadBulkPaymentXLS(filename, rows);

      const { error: markError } = await (supabase as any)
        .from("payroll_follow_up_payments")
        .update({ status: "exported", exported_at: new Date().toISOString() })
        .in("id", exportIds);
      if (markError) throw markError;
      toast.success(
        `Pembayaran susulan ${exportIds.length} rider berhasil diexport` +
          (kasbonRows.length ? `, termasuk ${kasbonRows.length} transfer ke penerima kasbon.` : "."),
      );
      await loadPaymentHolds(details.map((row) => row.id));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExportingFollowUp(false);
    }
  };

  // Compute stepper step: 1=select period, 2=cek data, 3=hitung, 4=review&commit
  const stepNum = !activeRun
    ? 1
    : activeRun.status === "published"
      ? 4
      : details.length > 0
        ? 4
        : 3;

  const STEPS = [
    { n: 1, label: "Pilih Periode" },
    { n: 2, label: "Cek Data" },
    { n: 3, label: "Hitung Fee" },
    { n: 4, label: "Review & Commit" },
  ];

  return (
    <AdminLayout title={t("payroll.title")} subtitle={t("payroll.subtitle")}>
      <div className="flex gap-6">
        {/* Run list sidebar */}
        <aside className="w-56 shrink-0">
          {/* Run dibuat OTOMATIS begitu commit di halaman Hitung Fee — gak
              perlu tombol "Buat Run Baru" lagi. "Refresh" di sini buat mastiin
              daftar ini nunjukin run terbaru kalau abis commit di tab/halaman
              lain sebelum balik ke sini. */}
          <button
            onClick={loadRuns}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm mb-3 disabled:opacity-50 hover:bg-muted transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Refresh
          </button>

          {!showHistory && (
            <button
              onClick={runWorkflowNow}
              disabled={runningWorkflow || loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm mb-3 disabled:opacity-50 hover:opacity-90 transition-opacity"
              title="Jalankan payroll workflow manual (tarik data API + hitung + buat run) untuk semua client berjadwal yang jatuh tempo hari ini"
            >
              {runningWorkflow ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {runningWorkflow ? "Menjalankan…" : "Run Workflow Sekarang"}
            </button>
          )}

          {!showHistory && (
            <button
              onClick={deleteEmptyDrafts}
              disabled={deletingBulk || loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border-2 border-border-strong text-destructive px-3 py-2 text-sm mb-3 disabled:opacity-50 hover:bg-destructive hover:text-destructive-foreground transition-colors"
              title="Hapus draft run yang belum ada detail rider (biasanya kebuat otomatis untuk client tanpa jadwal)"
            >
              {deletingBulk ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {deletingBulk ? "Menghapus…" : "Hapus Draft Kosong"}
            </button>
          )}

          {/* Toggle Aktif/History — history = udah published, gak nyampur sama
              run yang masih draft/finalized. Filter status doang, data TETAP
              di tabel payroll_runs yang sama (gak dipindah ke tabel lain, biar
              relasi payroll_details/deductions/payslips ke run_id gak putus). */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted mb-3">
            {(
              [
                [false, "Aktif"],
                [true, "History"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setShowHistory(v);
                  loadRuns();
                }}
                className={
                  "text-[12px] font-semibold py-1.5 rounded-md transition-colors " +
                  (showHistory === v
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-1">
            {loading && !runs.length ? (
              <Loader2 className="w-4 h-4 animate-spin mx-auto" />
            ) : (
              pagedRuns.map((r) => {
                  const isActive = activeRun?.id === r.id;
                  const statusColor = isActive
                    ? "text-primary-foreground"
                    : r.status === "published"
                      ? "text-primary"
                      : r.status === "finalized"
                        ? "text-warning"
                        : "text-muted-foreground";
                  const clientName = r.client_id
                    ? (clients.find((c) => c.id === r.client_id)?.name ?? "(client tak dikenal)")
                    : "Semua Client";
                  return (
                    <button
                      key={r.id}
                      onClick={() => setActiveRun(r)}
                      className={`w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors ${isActive ? "bg-primary text-primary-foreground border-2 border-border-strong shadow-[3px_3px_0_0_var(--color-border-strong)] font-medium" : "hover:bg-muted/60"}`}
                    >
                      <div className="truncate font-medium text-[13px]">{clientName}</div>
                      <div className={`text-xs mt-0.5 truncate ${isActive ? "text-primary-foreground opacity-90" : "text-muted-foreground"}`}>
                        {r.name}
                      </div>
                      <div className={`text-xs mt-0.5 font-semibold ${statusColor}`}>
                        {r.period_start} → {r.period_end} · {r.status}
                      </div>
                    </button>
                  );
                })
            )}
            {!loading && filteredRuns.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-2">
                {showHistory
                  ? "Belum ada run yang di-publish."
                  : "Belum ada run aktif — hitung fee dulu di halaman Hitung Fee, run-nya otomatis muncul di sini."}
              </p>
            )}
          </div>

          {runTotalPages > 1 && (
            <div className="flex items-center justify-between mt-2 px-1">
              <button
                onClick={() => setRunPage((p) => Math.max(1, p - 1))}
                disabled={runPage <= 1}
                className="p-1 rounded-md border border-border disabled:opacity-40 hover:bg-muted"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] text-muted-foreground">
                {runPage} / {runTotalPages}
              </span>
              <button
                onClick={() => setRunPage((p) => Math.min(runTotalPages, p + 1))}
                disabled={runPage >= runTotalPages}
                className="p-1 rounded-md border border-border disabled:opacity-40 hover:bg-muted"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </aside>

        {/* Main area */}
        <section className="flex-1 min-w-0">
          {!activeRun ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-muted grid place-items-center text-muted-foreground">
                <Plus className="w-5 h-5" />
              </div>
              <p className="text-sm text-muted-foreground max-w-sm">
                Pilih run dari daftar di kiri. Run baru otomatis muncul begitu kamu commit hasil
                hitungan di halaman Hitung Fee.
              </p>
              <Link
                to="/admin/calculate"
                className="text-sm text-primary font-medium hover:underline"
              >
                Buka Hitung Fee →
              </Link>
            </div>
          ) : (
            <>
              {/* Stepper */}
              <div className="flex items-center mb-5 rounded-xl border border-border bg-card p-4 gap-1">
                {STEPS.map((s, i) => {
                  const done = s.n < stepNum || (s.n === 4 && activeRun.status === "published");
                  const active = s.n === stepNum && activeRun.status !== "published";
                  return (
                    <div key={s.n} className="flex items-center flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-full grid place-items-center flex-shrink-0 text-xs font-bold transition-colors
                          ${done ? "bg-success text-success-foreground" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                        >
                          {done ? <CheckCircle2 className="w-4 h-4" /> : s.n}
                        </div>
                        <span
                          className={`text-[12px] font-medium truncate hidden sm:block ${active ? "text-foreground" : done ? "text-success" : "text-muted-foreground"}`}
                        >
                          {s.label}
                        </span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <div
                          className={`flex-1 mx-2 h-px ${s.n < stepNum ? "bg-success/50" : "bg-border"}`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Run info + step actions */}
              <div className="rounded-xl border border-border bg-card p-4 mb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-semibold">{activeRun.name}</div>
                    <div className="text-[12px] text-muted-foreground mt-0.5">
                      {activeRun.period_start} → {activeRun.period_end}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {/* Step 2: Cek Data link — bawa periode run aktif biar auto-jalan, gak perlu pilih ulang */}
                    <Link
                      to="/admin/data-check"
                      search={{ from: activeRun.period_start, to: activeRun.period_end }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Cek Data
                    </Link>
                    {/* Step 3: Generate */}
                    <button
                      onClick={generate}
                      disabled={loading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] disabled:opacity-50 hover:bg-muted transition-colors"
                    >
                      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      {details.length > 0 ? "Generate Ulang" : "Hitung Fee"}
                    </button>
                    {/* Step 4: Finalize */}
                    <button
                      onClick={finalize}
                      disabled={activeRun.status !== "draft" || finalizing || details.length === 0}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-warning text-warning-foreground px-3 py-1.5 text-[13px] disabled:opacity-40 transition-colors"
                    >
                      {finalizing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}{" "}
                      Finalize
                    </button>
                    {/* Step 4: Publish */}
                    <button
                      onClick={publish}
                      disabled={
                        activeRun.status === "published" || publishing || details.length === 0
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-[13px] disabled:opacity-40 transition-colors"
                    >
                      {publishing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}{" "}
                      Publish
                    </button>
                    {/* Export — konsolidasi CSV/XLS jadi 1 dropdown */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          disabled={
                            activeRun.status === "draft" || exportingBulk || details.length === 0
                          }
                          title={
                            activeRun.status === "draft" ? "Finalize dulu" : "Download bulk payment"
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] text-muted-foreground disabled:opacity-40 disabled:active:scale-100 hover:border-primary-border hover:text-primary hover:bg-muted active:scale-[0.97] transition-all"
                        >
                          {exportingBulk ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}{" "}
                          Bulk Payment <ChevronDown className="w-3 h-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        <DropdownMenuItem
                          onClick={() => exportBulkPayment("csv")}
                          className="flex-col items-start gap-0.5 py-2"
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <Download className="w-3.5 h-3.5" /> CSV
                          </span>
                          <span className="text-xs text-muted-foreground pl-5">
                            Buat import ke internet banking
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => exportBulkPayment("xls")}
                          className="flex-col items-start gap-0.5 py-2"
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <Download className="w-3.5 h-3.5" /> XLS
                          </span>
                          <span className="text-xs text-muted-foreground pl-5">
                            Format Excel, sama isinya dengan CSV
                          </span>
                        </DropdownMenuItem>
                        <div className="my-1 border-t border-border" />
                        <DropdownMenuItem
                          onClick={() => exportFollowUpPayment("csv")}
                          disabled={exportingFollowUp}
                          className="flex-col items-start gap-0.5 py-2"
                        >
                          <span className="flex items-center gap-2 font-medium">
                            {exportingFollowUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Pembayaran Susulan (CSV)
                          </span>
                          <span className="text-xs text-muted-foreground pl-5">
                            Khusus rider yang hold-nya sudah dilepas
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => exportFollowUpPayment("xls")}
                          disabled={exportingFollowUp}
                          className="flex-col items-start gap-0.5 py-2"
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <Download className="w-3.5 h-3.5" /> Pembayaran Susulan (XLS)
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <button
                      onClick={openSpendControlPreview}
                      disabled={activeRun.status === "draft" || details.length === 0}
                      title={activeRun.status === "draft" ? "Finalize dulu" : "Preview push ke Spend Control"}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] text-muted-foreground disabled:opacity-40 hover:border-primary-border hover:text-primary hover:bg-muted active:scale-[0.97] transition-all"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" /> Push ke Spend Control
                    </button>
                    {/* Hapus run — cuma kalau masih draft (belum Finalize) */}
                    {activeRun.status === "draft" && (
                      <button
                        onClick={deleteRun}
                        disabled={deletingRun}
                        title="Hapus run ini (cuma bisa selagi masih draft)"
                        className="inline-flex items-center gap-1.5 rounded-lg border-2 border-border-strong text-destructive px-3 py-1.5 text-[13px] disabled:opacity-40 hover:bg-destructive hover:text-destructive-foreground transition-colors"
                      >
                        {deletingRun ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}{" "}
                        Hapus Run
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Netting potongan lintas client — rider kekurangan gross buat nutup
                  potongannya sendiri di run ini, tapi punya headroom di run client
                  lain (draft, periode overlap). Cuma warning + tombol opsional,
                  gak otomatis — admin yang putusin. */}
              {nettingCandidates.length > 0 && (
                <div className="rounded-xl border-[3px] border-border-strong bg-card shadow-[6px_6px_0_0_var(--color-border-strong)] overflow-hidden mb-4">
                  <div className="px-3 py-2 bg-warning text-warning-foreground text-[12px] font-medium flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> {nettingCandidates.length} rider
                    kekurangan gross buat nutup potongan di run ini — ada sisa di run client lain
                  </div>
                  <div className="divide-y divide-border">
                    {nettingCandidates.map((c) => (
                      <div
                        key={c.detailId}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[13px]"
                      >
                        <div>
                          <span className="font-medium">{c.riderName}</span>{" "}
                          <span className="text-muted-foreground">({c.employeeId})</span> — kurang{" "}
                          <span className="font-medium text-warning">
                            Rp{c.shortfall.toLocaleString("id-ID")}
                          </span>
                          , ada sisa Rp{c.headroom.toLocaleString("id-ID")} di{" "}
                          <span className="font-medium">{c.siblingRunName}</span>
                        </div>
                        <button
                          onClick={() => applyNetting(c)}
                          disabled={nettingBusyId === c.detailId}
                          className="inline-flex items-center gap-1.5 rounded-md bg-warning text-warning-foreground px-2.5 py-1 text-[12px] disabled:opacity-50"
                        >
                          {nettingBusyId === c.detailId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : null}
                          Netting Rp{Math.min(c.shortfall, c.headroom).toLocaleString("id-ID")}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Riwayat Hitung Fee periode ini — review sebelum Generate/Finalize.
                  Sumber: fee_calculation_audit_log (dicatat tiap commit di Hitung Fee). */}
              {feeAuditLog.length > 0 && (
                <div className="rounded-xl border border-border overflow-x-auto mb-4">
                  <div className="px-3 py-2 bg-muted/60 text-[12px] font-medium text-muted-foreground">
                    Riwayat Hitung Fee periode ini ({feeAuditLog.length}) — cek dulu sebelum
                    Generate/Finalize
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="px-3 py-2 font-medium text-[12px] text-muted-foreground">
                          Client
                        </th>
                        <th className="px-2 py-2 font-medium text-[12px] text-muted-foreground">
                          Skema
                        </th>
                        <th className="px-2 py-2 font-medium text-[12px] text-muted-foreground">
                          Periode
                        </th>
                        <th className="px-2 py-2 font-medium text-[12px] text-muted-foreground">
                          Baris
                        </th>
                        <th className="px-2 py-2 font-medium text-[12px] text-muted-foreground">
                          Total
                        </th>
                        <th className="px-2 py-2 font-medium text-[12px] text-muted-foreground">
                          Kapan
                        </th>
                        <th className="px-2 py-2 w-36" />
                      </tr>
                    </thead>
                    <tbody>
                      {feeAuditLog.map((a) => (
                        <tr
                          key={a.id}
                          className={`border-t border-border/60 ${a.rejected_at ? "opacity-50" : ""}`}
                        >
                          <td className="px-3 py-2 text-[13px]">
                            {a.client_id
                              ? (clients.find((c) => c.id === a.client_id)?.name ??
                                "(tidak dikenal)")
                              : "Semua Client"}
                          </td>
                          <td className="px-2 py-2 text-[13px] text-muted-foreground">
                            {a.scheme_name ?? "—"}
                          </td>
                          <td className="px-2 py-2 text-[13px] text-muted-foreground">
                            {a.period_start} → {a.period_end}
                          </td>
                          <td className="px-2 py-2 text-[13px] tabular-nums">{a.row_count}</td>
                          <td className="px-2 py-2 text-[13px] tabular-nums">
                            Rp{Number(a.total_amount).toLocaleString("id-ID")}
                          </td>
                          <td className="px-2 py-2 text-[12px] text-muted-foreground">
                            {new Date(a.created_at).toLocaleString("id-ID")}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center justify-end gap-1.5">
                              {a.rejected_at ? (
                                <span className="whitespace-nowrap rounded-md border-2 border-border-strong bg-destructive text-destructive-foreground px-2 py-1 text-[11px]">
                                  Rejected
                                </span>
                              ) : a.action === "commit_payroll" ? (
                                <button
                                  onClick={() => rejectCalculation(a)}
                                  title="Salah pilih tanggal/client? Reset baris ini balik ke fee=0"
                                  className="whitespace-nowrap rounded-md border-2 border-border-strong text-destructive px-2 py-1 text-[11px] hover:bg-destructive hover:text-destructive-foreground transition-colors"
                                >
                                  Reject
                                </button>
                              ) : null}
                              <button
                                onClick={() => deleteAuditEntry(a)}
                                title="Hapus baris riwayat ini (cuma catatannya, gak nyentuh fee yang udah tersimpan)"
                                className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Detail table */}
              {details.length > 0 && (
                <div className="flex justify-end mb-2">
                  <PageSizeSelect pageSize={detailPageSize} setPageSize={setDetailPageSize} />
                </div>
              )}
              <div className="rounded-xl border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-left">
                    <tr>
                      <th className="px-3 py-2.5 font-medium text-[12px] text-muted-foreground">
                        Rider
                      </th>
                      <th className="px-2 py-2.5 font-medium text-[12px] text-muted-foreground">
                        Deliv
                      </th>
                      <th className="px-2 py-2.5 font-medium text-[12px] text-muted-foreground">
                        Fee Deliv
                      </th>
                      <th className="px-2 py-2.5 font-medium text-[12px] text-muted-foreground">
                        Fee Absensi
                      </th>
                      <th className="px-2 py-2.5 font-medium text-[12px] text-muted-foreground">
                        Insentif
                      </th>
                      <th className="px-2 py-2.5 font-medium text-[12px] text-muted-foreground">
                        Penalty
                      </th>
                      <th className="px-2 py-2.5 font-medium text-[12px] text-muted-foreground">
                        Gross
                      </th>
                      <th className="px-2 py-2.5 font-medium text-[12px] text-muted-foreground">
                        Potongan
                      </th>
                      <th className="px-2 py-2.5 font-medium text-[12px] text-muted-foreground">
                        Net Pay
                      </th>
                      <th className="px-2 py-2.5 font-medium text-[12px] text-muted-foreground">
                        Pembayaran
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="p-8 text-center text-muted-foreground text-sm">
                          Belum ada detail — klik "Hitung Fee" untuk generate
                        </td>
                      </tr>
                    ) : (
                      pagedDetails.map((d) => (
                        <Fragment key={d.id}>
                          <tr className="border-t border-border hover:bg-muted/30 transition-colors">
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-[13px]">{d.riders?.full_name}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {d.riders?.employee_id}
                              </div>
                            </td>
                            <td className="px-2 py-2.5 text-[13px]">{d.delivery_count}</td>
                            <td className="px-2 py-2.5 text-[13px] tabular-nums">
                              Rp{Number(d.delivery_fee).toLocaleString("id-ID")}
                            </td>
                            <td className="px-2 py-2.5 text-[13px] tabular-nums">
                              Rp{Number(d.attendance_fee).toLocaleString("id-ID")}
                            </td>
                            <td className="px-2 py-2.5 text-[13px] tabular-nums">
                              Rp{Number(d.incentive).toLocaleString("id-ID")}
                            </td>
                            <td className={`px-2 py-2.5 text-[13px] tabular-nums ${Number(d.penalty) > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                              Rp{Number(d.penalty).toLocaleString("id-ID")}
                            </td>
                            <td className="px-2 py-2.5 text-[13px] tabular-nums">
                              Rp{Number(d.gross_earning).toLocaleString("id-ID")}
                            </td>
                            <td className="px-2 py-2.5 text-[13px] tabular-nums text-destructive">
                              <button
                                onClick={() => toggleDeductions(d.id)}
                                className="inline-flex items-center gap-1 hover:underline"
                                title="Lihat rincian potongan & insentif tambahan"
                              >
                                {expandedDetailId === d.id ? (
                                  <ChevronDown className="w-3 h-3" />
                                ) : (
                                  <ChevronRight className="w-3 h-3" />
                                )}
                                Rp{Number(d.total_deduction).toLocaleString("id-ID")}
                              </button>
                            </td>
                            <td className="px-2 py-2.5 text-[13px] tabular-nums font-semibold">
                              Rp{Number(d.net_pay).toLocaleString("id-ID")}
                            </td>
                            <td className="px-2 py-2.5 text-[12px]">
                              {paymentHolds[d.id]?.status === "held" ? (
                                <div className="space-y-1">
                                  <span className="inline-flex rounded-full border-2 border-border-strong bg-warning px-2 py-0.5 font-medium text-warning-foreground">
                                    Ditahan
                                  </span>
                                  <p className="max-w-36 truncate text-[10px] text-muted-foreground" title={paymentHolds[d.id].reason}>
                                    {paymentHolds[d.id].reason}
                                  </p>
                                  <button
                                    onClick={() => releasePaymentHold(paymentHolds[d.id])}
                                    disabled={paymentHoldBusyId === d.id}
                                    className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                                  >
                                    {paymentHoldBusyId === d.id ? "Memproses…" : "Lepaskan hold"}
                                  </button>
                                </div>
                              ) : paymentHolds[d.id]?.status === "released" ? (
                                <div className="space-y-1">
                                  <span className="inline-flex rounded-full border-2 border-border-strong bg-success px-2 py-0.5 font-medium text-success-foreground">
                                    Susulan
                                  </span>
                                  <p className="text-[10px] text-muted-foreground">
                                    {paymentHolds[d.id].payroll_follow_up_payments?.[0]?.status === "exported" ? "Sudah diexport" : "Siap diexport"}
                                  </p>
                                </div>
                              ) : activeRun.status === "draft" ? (
                                <span className="text-[11px] text-muted-foreground">Finalize dulu</span>
                              ) : (
                                <button
                                  onClick={() => {
                                    setHoldDetail(d);
                                    setHoldReason("");
                                  }}
                                  disabled={paymentHoldBusyId === d.id || Number(d.net_pay) <= 0}
                                  title={Number(d.net_pay) <= 0 ? "Net pay harus lebih dari Rp0" : "Tahan dari bulk payment reguler"}
                                  className="rounded-md border-2 border-border-strong bg-warning px-2 py-1 text-[11px] font-semibold text-warning-foreground hover:bg-warning/85 disabled:opacity-50"
                                >
                                  {paymentHoldBusyId === d.id ? "Memproses…" : "Hold payment"}
                                </button>
                              )}
                            </td>
                          </tr>
                          {expandedDetailId === d.id && (
                            <tr className="border-t border-border/60 bg-muted/20">
                              <td colSpan={10} className="px-4 py-3">
                                {loadingDeductions ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <div className="space-y-1.5">
                                    {(deductionsByDetail[d.id] ?? []).map((ded) => (
                                      <div
                                        key={ded.id}
                                        className="flex items-center gap-3 text-[13px]"
                                      >
                                        {editingDeductionId === ded.id ? (
                                          <>
                                            <select
                                              value={editTypeId ?? ""}
                                              onChange={(e) =>
                                                setEditTypeId(e.target.value || null)
                                              }
                                              className="rounded-md border border-border bg-background px-2 py-1 text-[12px]"
                                            >
                                              <option value="">(tanpa jenis)</option>
                                              {dTypes.map((dt) => (
                                                <option key={dt.id} value={dt.id}>
                                                  {dt.name}
                                                </option>
                                              ))}
                                            </select>
                                            <input
                                              value={editDescription}
                                              onChange={(e) => setEditDescription(e.target.value)}
                                              placeholder="Deskripsi"
                                              className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-[12px]"
                                            />
                                            <input
                                              inputMode="numeric"
                                              value={
                                                editAmount ? editAmount.toLocaleString("id-ID") : ""
                                              }
                                              onChange={(e) =>
                                                setEditAmount(parseRupiah(e.target.value))
                                              }
                                              className="w-32 rounded-md border border-border bg-background px-2 py-1 text-[12px] text-right tabular-nums"
                                            />
                                            <button
                                              onClick={() => saveDeductionEdit(ded)}
                                              disabled={savingDeduction}
                                              className="rounded-md bg-primary text-primary-foreground px-2.5 py-1 text-[12px] disabled:opacity-50"
                                            >
                                              {savingDeduction ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                              ) : (
                                                "Simpan"
                                              )}
                                            </button>
                                            <button
                                              onClick={() => setEditingDeductionId(null)}
                                              className="text-[12px] text-muted-foreground hover:text-foreground"
                                            >
                                              Batal
                                            </button>
                                          </>
                                        ) : (
                                          <>
                                            <span className="w-40 truncate text-muted-foreground">
                                              {ded.deduction_types?.name ?? "(tanpa jenis)"}
                                            </span>
                                            <span className="flex-1 truncate">
                                              {ded.description ?? "—"}
                                            </span>
                                            <span className="w-32 text-right tabular-nums font-medium">
                                              Rp{Number(ded.amount).toLocaleString("id-ID")}
                                            </span>
                                            {activeRun.status !== "published" && (
                                              <button
                                                onClick={() => startEditDeduction(ded)}
                                                title="Edit potongan ini"
                                                className="text-muted-foreground hover:text-primary"
                                              >
                                                <Pencil className="w-3.5 h-3.5" />
                                              </button>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    ))}
                                    {activeRun.status !== "published" &&
                                      (addingDedForDetail === d.id ? (
                                        <div className="flex items-center gap-2 pt-1">
                                          <select
                                            value={newDedTypeId ?? ""}
                                            onChange={(e) => setNewDedTypeId(e.target.value || null)}
                                            className="w-40 rounded-md border border-border bg-background px-2 py-1 text-[12px]"
                                          >
                                            <option value="">(tanpa jenis)</option>
                                            {dTypes.map((dt) => (
                                              <option key={dt.id} value={dt.id}>
                                                {dt.name}
                                              </option>
                                            ))}
                                          </select>
                                          <input
                                            value={newDedDescription}
                                            onChange={(e) => setNewDedDescription(e.target.value)}
                                            placeholder="Keterangan (mis. Kasbon dadakan)"
                                            className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-[12px]"
                                          />
                                          <input
                                            inputMode="numeric"
                                            value={newDedAmount ? newDedAmount.toLocaleString("id-ID") : ""}
                                            onChange={(e) => setNewDedAmount(parseRupiah(e.target.value))}
                                            placeholder="Jumlah"
                                            className="w-32 rounded-md border border-border bg-background px-2 py-1 text-[12px] text-right tabular-nums"
                                          />
                                          <button
                                            onClick={() => addDeduction(d.id)}
                                            disabled={savingDeduction}
                                            className="rounded-md bg-primary text-primary-foreground px-2.5 py-1 text-[12px] disabled:opacity-50"
                                          >
                                            {savingDeduction ? (
                                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                              "Simpan"
                                            )}
                                          </button>
                                          <button
                                            onClick={() => setAddingDedForDetail(null)}
                                            className="text-[12px] text-muted-foreground hover:text-foreground"
                                          >
                                            Batal
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => setAddingDedForDetail(d.id)}
                                          className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline pt-1"
                                        >
                                          <Plus className="w-3.5 h-3.5" /> Tambah Potongan
                                        </button>
                                      ))}
                                    {activeRun.status === "published" && (
                                      <p className="text-[11px] text-muted-foreground pt-1">
                                        Run sudah di-publish — potongan gak bisa diedit lagi dari
                                        sini (payslip udah jadi snapshot tetap).
                                      </p>
                                    )}
                                    <div className="border-t border-border/60 pt-2 mt-1">
                                      <IncentiveEditor
                                        detailId={d.id}
                                        grossEarning={d.gross_earning}
                                        incentive={d.incentive}
                                        totalDeduction={d.total_deduction}
                                        runPublished={activeRun.status === "published"}
                                        onSaved={(detailId, newIncentive, newGross, newNet) =>
                                          setDetails((prev) =>
                                            prev.map((x) =>
                                              x.id === detailId
                                                ? {
                                                    ...x,
                                                    incentive: newIncentive,
                                                    gross_earning: newGross,
                                                    net_pay: newNet,
                                                  }
                                                : x,
                                            ),
                                          )
                                        }
                                      />
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {details.length > 0 && (
                <PaginationBar
                  page={detailPage}
                  totalPages={detailTotalPages}
                  setPage={setDetailPage}
                  from={detailFrom}
                  to={detailTo}
                  total={detailTotal}
                />
              )}
            </>
          )}
        </section>
      </div>
      <Dialog
        open={!!holdDetail}
        onOpenChange={(open) => {
          if (!open && !paymentHoldBusyId) {
            setHoldDetail(null);
            setHoldReason("");
          }
        }}
      >
        <DialogContent className="max-w-md rounded-2xl border-border bg-card p-0 overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-warning via-primary to-primary" />
          <div className="p-6">
            <DialogHeader>
              <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl border-2 border-border-strong bg-warning text-warning-foreground">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <DialogTitle className="text-xl">Tahan pembayaran rider</DialogTitle>
              <DialogDescription className="leading-relaxed">
                {holdDetail?.riders?.full_name ?? "Rider"} tidak akan masuk file Bulk Payment reguler. Nominal gaji dan payslip tetap tersimpan.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 space-y-3">
              <label htmlFor="payment-hold-reason" className="text-sm font-medium">
                Alasan hold <span className="text-destructive">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {["Verifikasi data", "Kasus operasional", "Menunggu persetujuan", "Dokumen belum lengkap"].map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setHoldReason(reason)}
                    className={`rounded-lg border-2 px-3 py-2 text-left text-xs font-medium transition-colors ${holdReason === reason ? "border-border-strong bg-warning text-warning-foreground" : "border-border text-muted-foreground hover:border-warning/50 hover:text-foreground"}`}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <textarea
                id="payment-hold-reason"
                value={holdReason}
                onChange={(event) => setHoldReason(event.target.value)}
                placeholder="Tulis alasan atau pilih alasan cepat di atas"
                rows={3}
                className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-warning focus:ring-2 focus:ring-warning/20"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Saat hold dilepas, sistem membuat pembayaran susulan terpisah sebesar net pay asli.
              </p>
            </div>
            <DialogFooter className="mt-6 gap-2 sm:gap-2">
              <button
                type="button"
                disabled={!!paymentHoldBusyId}
                onClick={() => {
                  setHoldDetail(null);
                  setHoldReason("");
                }}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={!holdDetail || !holdReason.trim() || !!paymentHoldBusyId}
                onClick={() => holdDetail && holdPayment(holdDetail, holdReason)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-warning-foreground hover:bg-warning/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {paymentHoldBusyId ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                Tahan pembayaran
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={spendControlOpen} onOpenChange={setSpendControlOpen}>
        <DialogContent className="max-w-4xl rounded-2xl border-border bg-card p-0 overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-primary via-warning to-primary" />
          <div className="p-6">
            <DialogHeader>
              <DialogTitle className="text-xl">Push ke Spend Control — Preview</DialogTitle>
              <DialogDescription className="leading-relaxed">
                Preview Payment Request per client untuk run {activeRun?.name}. Belum mengirim apa pun — integrasi API Spend Control masih menunggu konfirmasi tim mereka.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4">
              <label className="text-xs text-muted-foreground font-medium">Departemen pengaju</label>
              <select
                value={spendControlDept}
                onChange={(event) => setSpendControlDept(event.target.value)}
                className="mt-1 w-full max-w-xs rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              >
                {SPEND_CONTROL_DEPARTMENTS.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
            </div>

            {spendControlLoading ? (
              <div className="mt-6 flex items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Menyiapkan preview...
              </div>
            ) : (
              <>
                <div className="mt-4 max-h-96 overflow-y-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted text-muted-foreground sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Client</th>
                        <th className="text-left px-3 py-2 font-medium">Title</th>
                        <th className="text-right px-3 py-2 font-medium">Amount</th>
                        <th className="text-left px-3 py-2 font-medium">Business Unit</th>
                        <th className="text-left px-3 py-2 font-medium">Contract</th>
                        <th className="text-left px-3 py-2 font-medium">Lampiran</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spendControlRows.map((row) => (
                        <tr key={row.clientId} className="border-t border-border">
                          <td className="px-3 py-2 whitespace-nowrap">{row.clientName}</td>
                          <td className="px-3 py-2">
                            <div className={row.title.length > SPEND_CONTROL_TITLE_LIMIT ? "text-destructive" : ""}>
                              {row.title}
                            </div>
                            {row.title.length > SPEND_CONTROL_TITLE_LIMIT && (
                              <div className="text-destructive text-[11px] mt-0.5">
                                {row.title.length}/{SPEND_CONTROL_TITLE_LIMIT} karakter — kepanjangan, perbaiki nama client sebelum push
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{formatRupiah(row.amount)}</td>
                          <td className="px-3 py-2">
                            {row.businessUnit ?? (
                              <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive text-[11px]">
                                Belum ada revenue stream
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {row.contract ?? (
                              <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive text-[11px]">
                                Contract belum diisi
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <a
                              href={SPEND_CONTROL_ATTACHMENT_URL}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary underline underline-offset-2 hover:text-primary/80"
                            >
                              Payroll detail
                            </a>
                          </td>
                        </tr>
                      ))}
                      {spendControlRows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                            Tidak ada client dengan detail payroll yang dapat dibayarkan di run ini.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {spendControlRows.filter((row) => row.valid).length} client siap push
                    {spendControlRows.some((row) => !row.valid)
                      ? `, ${spendControlRows.filter((row) => !row.valid).length} di-exclude (data belum lengkap)`
                      : ""}
                  </span>
                  <span className="font-medium text-foreground">
                    Total: {formatRupiah(spendControlRows.filter((row) => row.valid).reduce((sum, row) => sum + row.amount, 0))}
                  </span>
                </div>
              </>
            )}

            <DialogFooter className="mt-6 gap-2 sm:gap-2">
              <button
                type="button"
                onClick={() => setSpendControlOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                Tutup
              </button>
              <button
                type="button"
                disabled={spendControlLoading || spendControlRows.filter((row) => row.valid).length === 0}
                onClick={() => toast.info("Integrasi API Spend Control masih menunggu konfirmasi tim mereka.")}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowUpRight className="h-4 w-4" /> Push ke Spend Control
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
