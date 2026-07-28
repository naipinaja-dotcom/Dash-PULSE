import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";
import { usePostHog } from "@posthog/react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin-layout";
import { PageSizeSelect, PaginationBar } from "@/components/pagination-bar";
import { usePagination } from "@/lib/use-pagination";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import {
  Plus,
  Loader2,
  CheckCircle2,
  Send,
  Download,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Trash2,
  Pencil,
  AlertTriangle,
} from "lucide-react";
import { generatePayrollDetails } from "@/lib/payroll-generate";
import { IncentiveEditor } from "@/components/incentive-editor";
import {
  downloadBulkPaymentCSV,
  downloadBulkPaymentXLS,
  type BulkPaymentRow,
} from "@/lib/bulk-payment-export";
import { parseRupiah } from "@/lib/format";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

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

function PayrollPage() {
  const posthog = usePostHog();
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [details, setDetails] = useState<Detail[]>([]);
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
    else setDetails((data ?? []) as any);
    // Detail lama ke-generate ulang dengan id baru tiap Generate Ulang —
    // cache expand/deduction lama jadi basi, bersihin biar gak nunjuk ke detail_id yg udah gak ada.
    setExpandedDetailId(null);
    setDeductionsByDetail({});
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
    const shortfallRows = details.filter((d) => d.total_deduction > d.gross_earning);
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
      const shortfall = d.total_deduction - d.gross_earning;
      const sib = (siblingDetails as any[])
        .filter((s) => s.rider_id === d.rider_id && s.gross_earning - s.total_deduction > 0)
        .sort(
          (a, b) => b.gross_earning - b.total_deduction - (a.gross_earning - a.total_deduction),
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
        headroom: sib.gross_earning - sib.total_deduction,
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

  // Koreksi 1 baris potongan yang udah ke-generate ke payroll run. Constraint
  // dari PRD §9.1: `payroll_deductions.amount` numpang ke `payroll_details.
  // total_deduction`/`net_pay` — jadi tiap edit HARUS recompute & simpan ulang
  // total di baris detail induknya, bukan cuma update baris deduction-nya.
  // Gak ada mekanisme buat "melindungi" edit manual ini dari Generate Ulang
  // (yang selalu hapus-total & bikin ulang semua detail+deduction dari nol) —
  // makanya di-warning eksplisit di toast, bukan diam-diam ketimpa nanti.
  const saveDeductionEdit = async (d: Deduction) => {
    if (!activeRun) return;
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
      const newTotalDed = list.reduce((s, x) => s + Number(x.amount), 0);
      const detail = details.find((x) => x.id === d.detail_id);
      if (!detail) throw new Error("Detail payroll tidak ditemukan di halaman ini — refresh dulu.");
      const newNet = Math.max(0, detail.gross_earning - newTotalDed);
      const { error: e2 } = await supabase
        .from("payroll_details")
        .update({ total_deduction: newTotalDed, net_pay: newNet })
        .eq("id", d.detail_id);
      if (e2) throw e2;

      setDeductionsByDetail((prev) => ({ ...prev, [d.detail_id]: list }));
      setDetails((prev) =>
        prev.map((x) =>
          x.id === d.detail_id ? { ...x, total_deduction: newTotalDed, net_pay: newNet } : x,
        ),
      );
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

  // "Generate Ulang" manual — dipakai kalau ada data yang berubah setelah run
  // ke-generate (mis. upload attendance baru, deduction ditambah) dan admin
  // mau recompute tanpa lewat Hitung Fee lagi. Pembuatan run itu sendiri
  // sekarang OTOMATIS (lihat commit() di admin.calculate.tsx — reuse
  // generatePayrollDetails() yang sama).
  const generate = async () => {
    if (!activeRun) return;
    if (
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
      // advance installments
      const { data: deds } = await supabase
        .from("payroll_deductions")
        .select("installment_id, amount, payroll_details!inner(run_id)")
        .eq("payroll_details.run_id", activeRun.id);
      for (const d of deds ?? []) {
        if (!d.installment_id) continue;
        const { data: ins } = await supabase
          .from("rider_installments")
          .select("*")
          .eq("id", d.installment_id)
          .single();
        if (!ins) continue;
        // mode='daily' (sewa) open-ended — gak ada installment_count buat
        // dibandingin, tetap aktif sampai admin nonaktifin manual pas unit
        // dikembaliin. Cuma mode='fixed' (cicilan) yang punya progress N/M.
        if (ins.mode === "daily") continue;
        const paid = ins.installments_paid + 1;
        const done = paid >= (ins.installment_count ?? 0);
        await supabase
          .from("rider_installments")
          .update({
            installments_paid: paid,
            active: !done,
          })
          .eq("id", ins.id);
      }
      const { error: e2 } = await supabase
        .from("payroll_runs")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", activeRun.id);
      if (e2) return toast.error(e2.message);
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
      const riderIds = [...new Set(details.map((d) => d.rider_id))];
      const { data: bankData, error } = await (supabase as any)
        .from("riders")
        .select("id, full_name, bank_name, bank_account, bank_account_holder")
        .in("id", riderIds);
      if (error) throw error;
      const bankOf = new Map((bankData ?? []).map((r: any) => [r.id, r]));

      // Gabung per rider (jaga-jaga kalau 1 rider punya >1 baris detail di run yang sama)
      const byRider = new Map<string, number>();
      for (const d of details)
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
      if (rows.length === 0)
        return toast.error("Tidak ada rider dengan data bank lengkap untuk di-export");

      const filename = `Bulk Payment - ${activeRun.name} - ${activeRun.period_end}`;
      if (format === "csv") downloadBulkPaymentCSV(filename, rows);
      else downloadBulkPaymentXLS(filename, rows);
      toast.success(`Bulk payment ${rows.length} rider berhasil di-generate`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExportingBulk(false);
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
    <AdminLayout title="Payroll Run" subtitle="Proses payroll rider step by step">
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
              runs
                .filter((r) => (showHistory ? r.status === "published" : r.status !== "published"))
                .map((r) => {
                  const statusColor =
                    r.status === "published"
                      ? "text-success"
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
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${activeRun?.id === r.id ? "bg-primary-soft text-primary-soft-foreground font-medium" : "hover:bg-muted/60"}`}
                    >
                      <div className="truncate font-medium text-[13px]">{clientName}</div>
                      <div className="text-[11px] mt-0.5 text-muted-foreground truncate">
                        {r.name}
                      </div>
                      <div className={`text-[11px] mt-0.5 ${statusColor}`}>
                        {r.period_start} → {r.period_end} · {r.status}
                      </div>
                    </button>
                  );
                })
            )}
            {!loading &&
              runs.filter((r) =>
                showHistory ? r.status === "published" : r.status !== "published",
              ).length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-2">
                  {showHistory
                    ? "Belum ada run yang di-publish."
                    : "Belum ada run aktif — hitung fee dulu di halaman Hitung Fee, run-nya otomatis muncul di sini."}
                </p>
              )}
          </div>
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
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {/* Hapus run — cuma kalau masih draft (belum Finalize) */}
                    {activeRun.status === "draft" && (
                      <button
                        onClick={deleteRun}
                        disabled={deletingRun}
                        title="Hapus run ini (cuma bisa selagi masih draft)"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 text-destructive px-3 py-1.5 text-[13px] disabled:opacity-40 hover:bg-destructive/10 transition-colors"
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
                <div className="rounded-xl border border-warning/40 bg-warning/5 overflow-hidden mb-4">
                  <div className="px-3 py-2 bg-warning/10 text-[12px] font-medium text-warning flex items-center gap-1.5">
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
                        <th className="px-2 py-2 w-16" />
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
                            {a.rejected_at ? (
                              <span className="whitespace-nowrap rounded-md bg-destructive/10 text-destructive px-2 py-1 text-[11px]">
                                Rejected
                              </span>
                            ) : a.action === "commit_payroll" ? (
                              <button
                                onClick={() => rejectCalculation(a)}
                                title="Salah pilih tanggal/client? Reset baris ini balik ke fee=0"
                                className="whitespace-nowrap rounded-md border border-destructive/40 text-destructive px-2 py-1 text-[11px] hover:bg-destructive/10 transition-colors"
                              >
                                Reject
                              </button>
                            ) : null}
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
                    </tr>
                  </thead>
                  <tbody>
                    {details.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="p-8 text-center text-muted-foreground text-sm">
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
                            <td className="px-2 py-2.5 text-[13px] tabular-nums text-destructive">
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
                          </tr>
                          {expandedDetailId === d.id && (
                            <tr className="border-t border-border/60 bg-muted/20">
                              <td colSpan={9} className="px-4 py-3">
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
                                              {dTypes.map((t) => (
                                                <option key={t.id} value={t.id}>
                                                  {t.name}
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
    </AdminLayout>
  );
}
