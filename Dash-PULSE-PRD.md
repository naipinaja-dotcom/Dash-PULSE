# Dash PULSE — Product Requirements Document
*Payroll, Utilization & Ledger System for Earnings — Rider Fee Calculation, Payroll & Client Billing Platform*

| Field | Detail |
|---|---|
| Product | Dash PULSE (repo/dir name: price-set-show; formerly referred to as "DASH Payroll") |
| Owner / Operator | Dash Electric |
| Document status | Living reference — reflects system as built, updated as features ship |
| Last updated | 24 July 2026 |
| Stack | React + TypeScript, TanStack Router/Start, Supabase (Postgres, Auth, RLS), Tailwind CSS |

---

## 1. Overview

### 1.1 Purpose of this document
This PRD documents Dash PULSE as it exists today: the problem it solves, who uses it, and how each module behaves. It is meant as a standing reference ("patokan project") — a single source of truth to onboard new contributors, evaluate new feature requests against existing behavior, and avoid re-litigating decisions already made in the system. It is descriptive of current behavior first, and prescriptive about near-term roadmap second (Section 9).

### 1.2 Problem statement
Dash Electric pays a network of delivery riders based on how much they deliver (per shipment: distance/weight-based) and/or how much they attend (per shift), and separately bills its own clients (the businesses whose goods riders deliver) for that same work — but at different rates and under different logic. Before this system, fee logic and payroll needed a way to be: configured per client without engineering changes, computed consistently and auditable, and turned into an operational payroll run (calculate → review → finalize → publish → pay) without spreadsheets.

### 1.3 Goals
- Let admins configure rider-cost and client-revenue pricing rules per client, without code changes, covering distance-based, weight-based, attendance-based, and combined delivery+attendance schemes.
- Turn uploaded delivery/attendance data into a computed, auditable fee, then into a reviewable payroll run, then into a published payslip and a bank-ready payment file.
- Let riders self-serve their own earnings and payslip history without asking an admin.
- Give leadership live and historical margin (revenue − cost) visibility per client, with automated weekly reporting.

### 1.4 Non-goals (explicitly out of scope today)
- Direct bank disbursement / payment execution — the system produces a bank-import file; the actual transfer happens outside Dash PULSE.
- External accounting/ERP integration — invoices are tracked in-app only (draft/finalized), not synced to any accounting system.
- Multi-role / granular permissions beyond a binary admin/rider split.
- Soft-delete / recycle-bin recovery — deletions across the app are hard deletes (see Section 14).

---

## 2. Users & Roles

### 2.1 Roles
The system recognizes exactly two roles, stored as rows in `user_roles`: `admin` and `rider`. The very first account ever created in the system is auto-promoted to admin (via a database trigger); every subsequent signup defaults to rider. There is no manager/finance/read-only tier today — anyone who needs admin capability needs the full admin role.

| Role | Can do | Cannot do |
|---|---|---|
| Admin | Full CRUD on clients, riders, pricing, uploads, calculations, payroll runs, deductions, invoices, analytics, user roles | Nothing is restricted within admin — it is a single flat permission tier |
| Rider | View own profile, own payslips, own outstanding installment balance; set/reset own PIN on first login | See other riders, clients, pricing, uploads, payroll admin, or analytics |

### 2.2 Personas
- **Ops/Finance Admin** — uploads delivery & attendance data weekly, runs fee calculations per client, reviews and finalizes payroll, exports the bank payment file, manages client billing invoices.
- **Pricing Administrator** — (often the same person) configures and maintains each client's rider-cost and client-revenue pricing schemes as commercial terms change.
- **Leadership / COO** — consumes the Executive Dashboard, weekly margin snapshots, and AI-generated weekly insight narrative to track which clients are profitable and why.
- **Rider** — logs in with Kode Mitra + PIN on a mobile browser to check current earnings and view past payslips.

### 2.3 Authentication model
Admin accounts use standard Supabase email/password login. Riders do not manage an email — the UI presents "Kode Mitra" (their `employee_id`) + a self-chosen 4–8 digit numeric PIN; under the hood this maps to a synthetic unreachable email and the PIN is stored as the Supabase Auth password. An admin "activates" a rider's login (individually or in bulk for CSV-imported riders whose status is `ready_to_work`/`active`), which creates the Auth user with a random placeholder password and forces `must_change_pin = true`. The rider then completes first-time PIN setup themselves, verified only by matching their registered phone number (rate-limited, with PIN-strength validation rejecting sequences like 1234 or repeated digits). Admins can later reset (force a new PIN setup) or unlink a rider's login.

All server-side access control is enforced via Postgres Row-Level Security, not just the client-side route guard: every business table carries an "admin all" policy (full CRUD gated on `has_role(auth.uid(),'admin')`) and, where relevant, a "read self" policy scoping riders to rows referencing their own `rider_id`/`user_id`.

---

## 3. System Architecture at a Glance

Single-page app: React + TypeScript on TanStack Router (file-based routes, e.g. `admin.payroll.tsx`, `rider.dashboard.tsx`) and TanStack Start server functions, talking to Supabase (Postgres + Auth + Row-Level Security) as the only backend. There is no separate application server — business logic that must run with elevated trust (PIN setup, bulk login activation, weekly PNL push, AI insight generation) runs as TanStack Start server functions; everything else queries Supabase directly from the client under RLS.

Two structurally separate route trees, each behind its own layout-level role guard: `/admin/*` and `/rider/*`, both redirecting to `/login` when unauthenticated. Unauthenticated or role-mismatched navigation is redirected client-side; the authoritative enforcement is still RLS at the database.

A recurring technical-debt marker across the codebase: several tables/columns added via migration after the last Supabase type-generation run are queried with an `(supabase as any)` cast rather than typed — this affects `payroll_runs.client_id`, `deduction_types.auto_recurring`, `attendance_logs`, `invoice_details`, `fee_calculation_audit_log`, and the `report_summary_weekly` view, among others. This is a known, intentional trade-off (regenerating types is a manual step not yet automated) rather than an oversight, but worth tracking as the schema keeps growing.

---

## 4. Core Domain Model

### 4.1 Entity summary

| Table | Purpose |
|---|---|
| `clients` | A billable customer of Dash Electric whose shipments/attendance riders are paid to fulfill. |
| `riders` | A delivery worker. Not permanently bound to one client — client association lives on each delivery/attendance row, not on the rider profile. |
| `delivery_records` | One row per shipment (uploaded via CSV): date, distance, weight, client, rider, status, computed fee. |
| `attendance_logs` | One row per rider per work day: clock-in/out, duration, late/absent flags, computed fee. |
| `pricing_schemes` | A configured fee formula ("envelope"), scoped to one client or all clients, and to either rider-cost or client-revenue. |
| `payroll_runs` | One payroll cycle: a client (or all clients) × a period, with a draft → finalized → published status. |
| `payroll_details` | One row per rider per run: aggregated delivery/attendance fee, deductions, and net pay for that run. |
| `payroll_deductions` | One line item of a deduction (installment or auto-recurring) applied to a `payroll_details` row. |
| `deduction_types` | A catalog entry for a kind of deduction (e.g. cash advance, uniform fee), with installment/auto-recurring behavior flags. |
| `rider_installments` | An active deduction schedule for one rider: total amount, number of installments, progress, next due date. |
| `payslips` | An immutable, frozen JSON snapshot of a `payroll_details` row, created on Publish — what the rider actually sees. |
| `invoice_details` | A client revenue invoice generated from a "client" pricing scheme commit. |
| `fee_calculation_audit_log` | Immutable trail of every fee commit (to payroll or to invoice): who, when, exact scheme snapshot, affected rows, and reject status. |
| `client_export_templates` | Per-client toggle of which columns appear in that client's Finance Worksheet export. |
| `upload_batches` | One row per CSV upload, parent record for traceability of the rows it inserted. |
| `report_summary_weekly` (view) | Canonical join of `payroll_details` + `payroll_runs` + `riders` + `clients` — all report pages read this, never `payroll_details` directly, to keep numbers consistent. |
| `pnl_weekly_snapshots` | Weekly computed margin snapshot per client, feeding the Executive Dashboard history and the COO Insights AI pipeline. |
| `coo_incident_reports` / `coo_insight_reports` | Manually logged qualitative incidents, and the AI-generated weekly narrative analysis, respectively. |
| `payroll_reminder_schedules` / `_log` | Configured per-client/per-rider disbursement reminders and their send history. |

### 4.2 Lifecycle: from upload to paid
1. Admin uploads a delivery and/or attendance CSV for a period (`admin.upload.tsx`). Unrecognized rider codes auto-create a rider profile; unrecognized client names are flagged, never guessed.
2. Admin runs "Hitung Fee" (`admin.calculate.tsx`): pick client + pricing scheme + date range → preview computed fee per rider/row, including flagged anomalies and skipped (non-completed) rows.
3. Admin commits: for a rider-cost scheme, this writes the computed fee onto every `delivery_records`/`attendance_logs` row, logs an immutable audit entry, and auto-creates or reuses a `payroll_runs` row for that client+period, then populates it (no separate "create run" step). For a client-revenue scheme, commit instead creates an `invoice_details` row.
4. Admin reviews the payroll run (`admin.payroll.tsx`): regenerates details if needed, finalizes (locks the numbers), then publishes — which snapshots each detail row into a `payslips` row (visible to the rider) and advances any installment schedules by one period.
5. Admin exports a bulk bank-payment file for all riders with `net_pay > 0` and valid bank details on file.
6. Rider logs in and sees their latest payslip and any remaining installment balance.

---

## 5. Module: Client & Rider Management

### 5.1 Clients (`admin.clients.tsx`)
- Full CRUD on clients: code, name, address, contact person, phone, active flag. Deletion is a hard delete.
- Each client's edit modal shows which pricing scheme currently applies to it (informational lookup, not editable there — pricing is managed under the Pricing module).
- Export Template tab (only visible when editing an existing client, not on create): admin toggles which Finance Worksheet export columns are enabled for this client. No saved template = all columns shown (backward compatible). Only takes effect for payroll runs scoped to a single client — a mixed "all clients" run always shows every column, since one template cannot serve multiple clients in a single table.
- Client list supports a client-side CSV export (not a stored template).

### 5.2 Riders (`admin.riders.tsx`)
- Full CRUD on rider profiles: `employee_id` ("Kode Mitra", unique), name, NIK, phone, email, optional `client_id`, status, bank details, birth info, notes.
- **Status values:** `ready_to_work`, `active`, `resign`, `blacklisted`, `withdrawn`, `suspended`. A quick-toggle button flips active ↔ withdrawn.
- Deleting a rider is a hard delete of the profile row only — historical delivery/attendance data referencing that `rider_id` is preserved (FK is `ON DELETE SET NULL` on those tables).
- Bulk CSV import: alias-aware header mapping (many Indonesian/English column-name variants recognized), upserts on `employee_id` conflict in batches of 200, parses Indonesian date formats, and auto-activates login for imported riders whose status is `ready_to_work`/`active` (bulk, up to 500 at a time) — resigned/blacklisted/withdrawn/suspended riders are explicitly skipped from auto-activation.
- In practice, most riders are first created implicitly by the delivery/attendance upload flow (unrecognized `driver_code` → auto-created rider) — the CSV import here is mainly used to enrich profile fields afterward, not as the primary onboarding path.
- Per-rider modal exposes Activate / Reset / Unlink login actions (see Section 2.3).

---

## 6. Module: Pricing Engine

This is the commercial core of the product: a configuration layer that turns raw delivery/attendance data into money, for both what Dash pays a rider (cost) and what Dash bills a client (revenue) — using the same calculation engine run twice with different parameters per client.

### 6.1 Scheme scope
- Each `pricing_schemes` row is scoped to one client or null ("applies to all clients"), and tagged `scheme_for = rider` (cost) or `client` (revenue). Margin for a client is always: (client-scheme result) − (rider-scheme result), computed live — there is no separately stored "margin" figure outside the weekly snapshot table.
- A scheme has an `effective_from`/`effective_to` window, so historical schemes can be superseded without deleting past configuration.

### 6.2 Categories exposed in the UI
- **Delivery ("Per Pengiriman")** — fee computed from `delivery_records`. Configured via two independent, combinable checkboxes: Distance and Weight. Each enabled dimension is configured as a range table (see 6.3).
- **Attendance ("Per Kehadiran")** — fee from `attendance_logs`: a daily base fee prorated by worked-minutes/standard-minutes, with optional overtime, optional named incentives (always, or on-time-only), optional multi-shift configuration (different shift windows each with their own full-fee/standard-minutes), and an optional "delivery component" toggle that folds a per-order/tier/threshold delivery fee on top of attendance in the same scheme.
- **Hybrid ("Kombinasi")** — legacy category, no longer offered when creating a new scheme, but existing schemes of this type still compute correctly.

### 6.3 Range-table model (current design, "modular_v2")
Both Distance and Weight dimensions are configured as an ordered table of bands (`RangeRow`): each band has a from/to range, a type (flat or tier), a base fee, and — for tier bands — a step size and an additional amount charged per step within that band.

- **Band-independent lookup:** a value is priced using only the single band it falls into (not cumulative through all lower bands) — a deliberate design choice distinguishing this from the older step-tier model still used by legacy scheme types.
- **Rate overrides (flat bands only):** `rate_by` can vary a flat band's rate by an arbitrary column, or by Delivery vs. Return type.
- **Weight-only "Kelipatan per Store" mode:** an alternative to the range table — groups rows by an arbitrary column (e.g. store/area), sums weight per group per day, divides by a configured threshold, rounds up, and multiplies by a flat rate.
- **Accumulate setting (per dimension):** `per_order` prices each row independently; `daily` sums the value (km or kg) per rider per day first, prices that daily total once, then allocates the resulting fee back across that day's rows proportionally (using integer allocation with no rounding leak — any remainder goes to the largest-weight row).

### 6.4 Modifiers (apply on top of any category)
- Add-per-kg — an extra tiered fee by weight, layered on top of the base calculation.
- Multi-drop — a flat extra fee from the rider's 2nd shipment of the same day onward.
- Billing add-ons (client/revenue schemes only) — minimum-charge floor, flat admin fee, and VAT percentage; computed only at the invoice/grand-total level, never per delivery row.

### 6.5 Business rules baked into the calculation engine
- Only delivery rows normalized to status "completed" are fee-eligible. Non-completed rows are skipped and itemized per rider per status for transparency — never silently zeroed.
- Anomaly flags (advisory only, never block computation): zero/missing distance with a nonzero fee, missing weight on a weight-dependent scheme, and fee = 0 on a completed row.
- Attendance: `is_absent` forces fee to zero. Late/incentive eligibility reads the `is_late` flag already present on the uploaded row (not re-derived per shift).
- A scheme's envelope must carry `version = 1` or the calculation screen refuses to run it and flags it as needing to be re-saved.

---

## 7. Module: Fee Calculation & Commit ("Hitung Fee")

`admin.calculate.tsx` is the workflow that turns configured pricing into an auditable, committed fee. It is intentionally a preview-then-commit flow — nothing is written to `delivery_records`/`attendance_logs` or created downstream until the admin explicitly commits.

### 7.1 Preview
- Admin selects a client, a matching pricing scheme (client-specific, or one of the "applies to all clients" schemes), and a date range.
- The engine computes and shows a per-rider summary with drill-down to individual rows (date/km/kg/fee), plus warnings, anomalies, and a skipped-rows breakdown by status.
- Rider identity is resolved with a fallback from `rider_id` to `driver_code`, so rows that were never matched to a rider profile still compute and display a name.

### 7.2 Commit — rider (cost) schemes: "Commit ke Payroll"
1. Writes the computed fee onto every affected `delivery_records`/`attendance_logs` row (batched in chunks of 100).
2. Writes one `fee_calculation_audit_log` entry: action `commit_payroll`, a full point-in-time snapshot of the scheme configuration used (not a live reference), period, row count, total amount, who committed it, and the exact list of affected row IDs.
3. Auto-creates (or reuses, if one already exists for that client+period and isn't yet published) a `payroll_runs` row, then immediately calls the payroll-details generator — so the payroll run is ready to review the moment the admin navigates to Payroll Run, with no separate manual "create run" step.

### 7.3 Commit — client (revenue) schemes: "Commit ke Invoice"
- Inserts one `invoice_details` row (status `draft`) with base/surcharge/total amounts and a full per-rider + billing breakdown JSON, plus the same audit-log pattern (action `commit_invoice`).

### 7.4 Reject
- Available only for `commit_payroll` audit entries (not `commit_invoice`), from the Payroll Run screen's "Riwayat Hitung Fee" panel.
- Resets exactly the `affected_row_ids` from that commit back to `fee = 0`, and stamps `rejected_at`/`rejected_by` on the audit row.
- Does not auto-correct any payroll run already generated from that commit — the admin must regenerate the run manually afterward. This is called out explicitly in the UI copy as a manual follow-up step, not automatic.

---

## 8. Module: Payroll Lifecycle (`admin.payroll.tsx`)

A `payroll_runs` row represents one payroll cycle for one client (or `client_id = null`, meaning "all clients together") over one period, and moves through three states with no reverse transition available in the UI: `draft → finalized → published`.

### 8.1 Generate ("Hitung Fee" / "Generate Ulang")
- Deletes any existing `payroll_details` for the run, then rebuilds them by summing already-committed `delivery_records.fee`/`attendance_logs.fee` per rider for the run's client + period.
- A rider with zero deliveries and zero attendance fee for the period gets no row at all — not a zero row. Riders with any earnings get exactly one `payroll_details` row.
- **Deductions applied automatically during generation:** (a) one `payroll_deductions` row per active `rider_installments` schedule due by the period end, labeled "Cicilan N/M"; (b) one `payroll_deductions` row per auto-recurring deduction type, applied to every rider with gross pay > 0 that period.
- `net_pay = max(0, gross_earning − total_deduction)` — floored at zero, never negative.
- The `incentive` and `penalty` columns exist on `payroll_details` but are currently always generated as 0 — any incentive logic that exists today lives inside the pricing scheme itself and folds into delivery/attendance fee, not into these two columns.

### 8.2 Finalize
- Requires `status = draft` and at least one `payroll_details` row. Sets `status = finalized` and stamps `finalized_at`. This is the checkpoint intended to lock the numbers before payment.

### 8.3 Publish
- Upserts one `payslips` row per `payroll_details` row (a frozen JSON snapshot of that detail row), sets `status = published` and stamps `published_at`.
- Advances every installment that contributed a deduction this run: `installments_paid += 1`, and deactivates the installment once `installments_paid` reaches `installment_count`.
- Publishing is what makes a payslip visible to the rider — rider-facing pages read `payslips`, never `payroll_details` directly.

### 8.4 Bulk payment export
- Available once a run is no longer `draft`. Exports `net_pay` per rider (riders with `net_pay ≤ 0` are skipped) as CSV or XLS in a format matching an existing bank-transfer import template.
- A rider missing `bank_name` or `bank_account` is excluded from the file with a warning, rather than exported with blank bank fields.

### 8.5 Navigation
- The sidebar's "Aktif" vs "History" toggle is purely a filter (`status ≠ published` vs. `status = published`) over the same underlying table — there is no separate archive table.
- The "Riwayat Hitung Fee" panel on this screen shows `fee_calculation_audit_log` entries overlapping the active run's period (and client, if scoped), so an admin can review or reject a commit before generating or finalizing.

### 8.6 Gaps versus the latest feature request (see Section 9)
- There is currently no way to edit an already-generated `payroll_deductions` line item directly — the only way to change a deduction's amount is to edit or delete the underlying `rider_installments` schedule and regenerate the run.
- There is currently no delete action for a `payroll_runs` row at any status — a run created by mistake (e.g. via an accidental commit) cannot be removed today; the only lever available is Reject on the originating audit log entry, which does not remove the run itself.

---

## 9. Roadmap — Requested & In Progress

The following two capabilities have been explicitly requested and are the current work item, tracked here as the standing reference for scope once implementation resumes.

### 9.1 Edit an already-entered deduction
Goal: let an admin correct a `payroll_deductions` line item (amount, description, and/or deduction type) after it has already been generated onto a payroll run, without having to delete and fully regenerate the run.

- **Open design questions:** should editing a deduction that originated from an active `rider_installments` schedule be blocked or warned (since "Generate Ulang" will recompute it from the installment schedule and silently overwrite a manual edit)? Should a manual one-off edit be tracked separately from the auto-generated installment/auto-recurring deductions so regeneration does not clobber it?
- **Constraint to preserve:** `payroll_deductions.amount` feeds directly into `payroll_details.total_deduction` and `net_pay` — any edit UI must recompute and persist those parent-row totals, not just the deduction row.

### 9.2 Delete a committed-but-not-finalized payroll run
Goal: let an admin delete a `payroll_runs` row while it is still `status = draft` (i.e., auto-created by a "Commit ke Payroll" action but not yet through Finalize), for cases where a run was created in error or needs to be scrapped and redone from scratch.

- **Verified safe by schema:** `payroll_details.run_id`, `payroll_deductions.detail_id`, and `payslips.run_id`/`detail_id` all cascade on delete (`ON DELETE CASCADE`), so deleting a draft `payroll_runs` row cleanly removes its details/deductions with no orphaned rows. Since a draft run has never been published, no `payslips` rows can exist for it yet regardless.
- **Gate condition:** the delete action should only be available when `status = draft` (i.e. before Finalize) — matching the user's own framing of "committed but not yet finalized."
- **Open design question:** should deleting a draft run also warn if a `fee_calculation_audit_log` entry still points at it (so the admin understands that deleting the run does not undo the underlying fee commit on `delivery_records`/`attendance_logs` — those fees remain written and would simply regenerate into a new run on the next commit or "Generate Ulang")?
- **Suggested pattern:** gated on `activeRun.status === "draft"`, reuse the existing `confirmDialog` pattern already used elsewhere on this screen (e.g. in Generate Ulang's confirmation), calling a hard delete on `payroll_runs.id`.

### 9.3 Deduction Summary Report ("Ringkasan Potongan")
**Status: designed, mockup approved, not yet implemented in code.**

Goal: give admin/finance a rolled-up view of total `payroll_deductions` collected — by client, by `deduction_types`, and per-rider — which today can only be answered by a manual query. This was identified as a reporting gap while auditing how deductions relate to margin/PNL (see 9.3.1 below); it is a new reporting surface, not a change to any existing calculation.

**9.3.1 Explicit non-goal — this does not touch PNL/margin**
Confirmed by code audit (`src/lib/pnl-engine.ts`, `src/routes/admin.pnl.tsx`, `pnl_weekly_snapshots`): margin is computed purely as `(client-scheme gross fee) − (rider-scheme gross fee)` from raw `delivery_records`/`attendance_logs`. `payroll_deductions` is never read by the PNL engine and must **stay** that way — deduction money is a rider-side cash-flow offset (cicilan/potongan repayment), not a Dash cost or revenue line, so it must not be netted into Cost/Margin KPIs. This report is an intentionally separate, parallel reporting surface, analogous to how `report_summary_weekly` already exists alongside (not inside) the PNL engine.

**9.3.2 Placement**
- Lives as a third tab inside the existing **Reports** page (`admin.reports.tsx`), alongside "Per Rider (Finance)" and "Ringkasan per Client" — not a new sidebar item. `admin.reports.tsx`'s local `mode` state extends from `"client" | "rider"` to `"client" | "rider" | "deduction"`, with a third button labeled "Ringkasan Potongan".
- Rendered via a new component, `src/components/deduction-summary.tsx` (kept out of `admin.reports.tsx` itself, following the existing `FinanceWorksheet` pattern, to stay under the project's 500-line-per-file limit).

**9.3.3 Data source**
Aggregates `payroll_deductions` joined to `payroll_details` → `payroll_runs`/`riders`/`clients` (same grain/join path already used by `report_summary_weekly` and `FinanceWorksheet`) — no new table required. Filterable by client and period, with CSV export matching the existing Reports conventions.

**9.3.4 Content (per approved mockup)**
- KPI cards: total potongan for the period, split installment vs. auto-recurring, and count of installments fully paid off in the period.
- Per-client rollup table (rider count + total).
- Per-deduction-type rollup table (by `deduction_types.name`, tagged installment vs. auto-recurring).
- Composition chart (donut) by deduction type.
- Per-rider breakdown table (Kode Mitra, name, client, deduction type, installment progress where applicable, amount) — server-paginated, following the same pattern as `admin.data-check.tsx` ("Cek Data").
- A visible disclaimer banner in the UI itself stating this is a cash-flow metric, separate from Margin/PNL, to prevent misreading it as a cost figure.

**9.3.5 Open item**
No company-wide historical rollup exists yet beyond the per-run/per-client sums already in `admin.reports.tsx`'s Client Report tab (see Section 9.3.3) — this report closes that gap going forward but does not backfill a "total ever collected" figure; it computes live from existing rows for whatever period/client filter is selected.

---

## 10. Module: Deductions (`admin.deductions.tsx`)

### 10.1 Jenis Potongan (deduction types)
- Catalog of `deduction_types`: code, name, description, and two flags — `installmentable` and `auto_recurring` — which are mutually exclusive in the UI. `auto_recurring` types also carry a flat `recurring_amount`.
- Deleting a type in use is blocked by its foreign-key relationships; the UI offers deactivating it (`active = false`) instead, which simply hides it from future selection without touching historical records.

### 10.2 Tambah Potongan (assign a deduction)
- Admin multi-selects riders + one deduction type + a total amount + a start date, with an optional installment split: an `installment_count` divides the total evenly into a `per_period_amount` (rounded to 2 decimals). One `rider_installments` row is created per selected rider. Only `installmentable` types allow the installment checkbox.

### 10.3 Cicilan Aktif (active installments)
- Lists active `rider_installments` with progress (`installments_paid`/`installment_count`) and the next due date.
- Deleting an active installment schedule is allowed at any point regardless of progress — it only stops future deductions; `payroll_deductions` rows already generated for past periods are untouched historically.

---

## 11. Module: Reporting, Invoicing & Data Tools

### 11.1 Reports (`admin.reports.tsx`)
- "Per Rider (Finance)" mode renders the Finance Worksheet component for a selected payroll run — the rider-level summary and the export governed by the per-client Export Template (Section 5.1).
- "Ringkasan per Client" mode aggregates from the `report_summary_weekly` view (never queries `payroll_details` directly, by design, to guarantee the same numbers appear everywhere), grouped by client, with CSV export.
- "Ringkasan Potongan" mode — **planned, not yet built** (see Section 9.3) — will aggregate `payroll_deductions` by client, deduction type, and rider, as a third tab alongside the two above. Explicitly does not feed into or read from the PNL/margin engine (Section 12).

### 11.2 Invoices (`admin.invoices.tsx`)
- Lists `invoice_details` created from "Commit ke Invoice" in the Hitung Fee flow. Filterable by client, exportable to CSV, with a grand-total footer.
- Finalize sets `status = finalized` as a manual reminder marker only — it does not technically lock the row from further edits. Delete is a hard delete with a confirmation dialog.
- Invoices are not connected to any external accounting/billing system — this is an in-app record only.

### 11.3 Cek Data (`admin.data-check.tsx`)
- A server-paginated raw browse of `delivery_records` joined to rider name, filterable by client/rider-code/date-range, used to distinguish "data genuinely missing from the database" from "a calculation problem." Deep-linkable with date params — the Payroll Run screen links here pre-filled to the active run's period.

### 11.4 Upload (`admin.upload.tsx`)
- **Delivery upload:** flexible column-mapping with fallback header-name detection, auto-creates missing riders from `driver_code`, matches client names against existing clients only (never auto-creates a client), and dedups/overwrites by `(dash_delivery_id, provider_order_id)` — a re-upload of a corrected file replaces matching rows rather than appending duplicates. Auto-classifies Delivery vs. Return type after insert. Includes manual utilities to reclassify all historical data and to deduplicate existing rows.
- **Attendance upload:** parses several duration formats and Indonesian long-form dates; dedups by `(driver_code, log_date)` with the same delete-and-replace semantics; derives `is_absent` from a missing clock-in and `is_late` from a source "OTP" column value.

---

## 12. Module: Analytics & Insights

All analytics pages are read-only and computed live against `delivery_records` (plus the dedicated PNL snapshot/COO tables), sharing one date range set on the Executive Dashboard (defaulting to the trailing 7 days).

| Page | What it shows |
|---|---|
| Executive Dashboard (pnl-dashboard) | The hub: KPI cards (Revenue/Cost/Margin/Margin%), revenue-vs-cost trend, margin-% trend with 0%/15% reference lines, top clients by margin, clients missing a revenue scheme, a payroll-overdue banner, and the Weekly PNL Push history/manual-trigger panel. |
| Margin Analytics (pnl.tsx) | Per-client Revenue − Cost = Margin, bucketed as loss (<0%), thin (0–15%), or healthy (≥15%). |
| Revenue Analytics | Revenue-only view: totals, trend, ranked client revenue with share bars. |
| BCR Analytics | Distribution of clients across the loss/thin/healthy margin buckets, trend, worst-first ranking. |
| Driver Analytics | Per-rider rollup: delivery count/fee, days worked/late/absent, attendance fee, total earning, on-time rate. |
| Shipment Analytics | Pure volume/status metrics — no money — total shipments, completion rate, RETURN count, daily volume. |
| COO Insights | Weekly AI-generated narrative (4-tier agent pipeline) covering WoW deltas, root-cause analysis, forecast, and recommended actions, plus manually logged qualitative incidents used as analysis context. |
| Payroll Reminders | Per-client/per-rider scheduled disbursement reminders (by weekday) with Slack/Email send history. |

A `pg_cron` job computes and snapshots margin data every Monday 07:00 WIB into `pnl_weekly_snapshots` and pushes it to Slack/Email; the same snapshot feeds the COO Insights AI pipeline as its weekly input.

---

## 13. Module: Rider Self-Service

- **Dashboard** — shows the most recently published payslip's net pay, gross earning, and total deduction, plus the rider's total remaining installment balance across all active schedules. Empty state if no payslip has been published yet.
- **Profile** — read-only display of the rider's own profile fields (Kode Mitra, NIK, phone, email, bank details, birth info, status). No self-service profile editing; only PIN management is self-service.
- **Payslips** — a list of the rider's own payslips; each opens a detail view joining that period's `payroll_deductions` to their `deduction_types.name`, showing delivery count, gross, itemized deductions, and net take-home. All figures come from the frozen `payslips.data` snapshot (plus a live join for deduction names) — never from live `payroll_details` — so a payslip's numbers cannot silently change after publish.
- A rider has no visibility into any other rider's data, client list, pricing configuration, or admin pages — enforced by both the route guard and RLS.

---

## 14. Cross-Cutting Rules & Constraints

### 14.1 Deletion policy
No table in the system implements soft-delete. Clients, riders, invoices, deduction types (when not FK-blocked), and installments are all hard-deleted. Where a hard delete would break referential integrity (e.g. a deduction type in use), the UI substitutes a "deactivate" flag rather than blocking silently or cascading unexpectedly.

### 14.2 Fee mutation & auditability
Once a fee is committed onto `delivery_records`/`attendance_logs`, the only sanctioned way to reverse it is the audit-log Reject mechanism, and that is explicitly scoped to payroll commits only (not invoice commits), and explicitly does not cascade-correct any payroll run already built from the rejected calculation — a manual regenerate is required afterward. There is no generic "undo" for a commit.

### 14.3 Upload semantics
CSV re-upload is the supported correction mechanism for delivery/attendance data: matched rows (by their dedup key) are deleted and reinserted, not skipped and not appended. This means re-uploading a corrected file is expected practice, not a hazard, but uploading an incomplete file will delete rows that the incomplete file no longer contains a matching key for.

### 14.4 Data consistency
All rider-facing and reporting pages that need aggregated payroll numbers read from the `report_summary_weekly` view (or the frozen `payslips.data` snapshot for riders specifically) rather than querying `payroll_details` directly, so that numbers shown in different parts of the app never drift apart due to different join logic.

---

## 15. Glossary (Indonesian UI terms)

| Term | Meaning |
|---|---|
| Kode Mitra | Rider's unique employee/partner code (`employee_id`) — used as their login username. |
| Hitung Fee | "Calculate Fee" — the preview-then-commit fee calculation workflow (Section 7). |
| Commit ke Payroll / Invoice | Writing a previewed calculation permanently: onto delivery/attendance rows and a payroll run, or into a client invoice, respectively. |
| Generate Ulang | "Regenerate" — rebuild a payroll run's detail rows from currently-committed fee data. |
| Cicilan | Installment — a scheduled multi-period deduction. |
| Potongan | Deduction. |
| Jenis Potongan | Deduction type (catalog entry). |
| Ringkasan | Summary (as in the Finance Worksheet's summary export). |
| Cek Data | "Check Data" — the raw delivery-record browser used for discrepancy investigation. |
| Riwayat Hitung Fee | Fee-calculation history panel (shows audit log entries) on the Payroll Run screen. |
