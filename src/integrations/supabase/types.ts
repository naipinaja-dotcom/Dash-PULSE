export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_users: {
        Row: {
          auth_user_id: string | null
          created_at: string | null
          id: string
          rider_id: string | null
          role: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string | null
          id?: string
          rider_id?: string | null
          role: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string | null
          id?: string
          rider_id?: string | null
          role?: string
        }
        Relationships: []
      }
      attendance_incentives: {
        Row: {
          amount: number
          amount_type: string | null
          attendance_rule_id: string | null
          condition_type: string
          condition_value: Json | null
          id: string
          incentive_name: string
          is_active: boolean | null
        }
        Insert: {
          amount: number
          amount_type?: string | null
          attendance_rule_id?: string | null
          condition_type: string
          condition_value?: Json | null
          id?: string
          incentive_name: string
          is_active?: boolean | null
        }
        Update: {
          amount?: number
          amount_type?: string | null
          attendance_rule_id?: string | null
          condition_type?: string
          condition_value?: Json | null
          id?: string
          incentive_name?: string
          is_active?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_incentives_attendance_rule_id_fkey"
            columns: ["attendance_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_logs: {
        Row: {
          batch_id: string | null
          client_id: string | null
          client_name: string | null
          clock_in: string | null
          clock_out: string | null
          created_at: string
          driver_code: string | null
          duration_minutes: number | null
          fee: number
          id: string
          is_absent: boolean
          is_late: boolean
          log_date: string
          rider_id: string | null
        }
        Insert: {
          batch_id?: string | null
          client_id?: string | null
          client_name?: string | null
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          driver_code?: string | null
          duration_minutes?: number | null
          fee?: number
          id?: string
          is_absent?: boolean
          is_late?: boolean
          log_date: string
          rider_id?: string | null
        }
        Update: {
          batch_id?: string | null
          client_id?: string | null
          client_name?: string | null
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          driver_code?: string | null
          duration_minutes?: number | null
          fee?: number
          id?: string
          is_absent?: boolean
          is_late?: boolean
          log_date?: string
          rider_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_logs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_logs_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_rules: {
        Row: {
          client_id: string | null
          created_at: string | null
          daily_base_fee: number
          expected_clockin: string | null
          expected_duration_minutes: number | null
          id: string
          incomplete_duration_penalty: number | null
          incomplete_duration_penalty_type: string | null
          is_active: boolean | null
          late_penalty: number | null
          late_penalty_type: string | null
          late_tolerance_minutes: number | null
          name: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          daily_base_fee: number
          expected_clockin?: string | null
          expected_duration_minutes?: number | null
          id?: string
          incomplete_duration_penalty?: number | null
          incomplete_duration_penalty_type?: string | null
          is_active?: boolean | null
          late_penalty?: number | null
          late_penalty_type?: string | null
          late_tolerance_minutes?: number | null
          name: string
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          daily_base_fee?: number
          expected_clockin?: string | null
          expected_duration_minutes?: number | null
          id?: string
          incomplete_duration_penalty?: number | null
          incomplete_duration_penalty_type?: string | null
          is_active?: boolean | null
          late_penalty?: number | null
          late_penalty_type?: string | null
          late_tolerance_minutes?: number | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_rules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          active: boolean
          address: string | null
          code: string
          contact_person: string | null
          created_at: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          code: string
          contact_person?: string | null
          created_at?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          code?: string
          contact_person?: string | null
          created_at?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      coo_incident_reports: {
        Row: {
          created_at: string
          description: string
          estimated_impact: number | null
          id: string
          resolved_at: string | null
          severity: string
          status: string
          type: string
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          description: string
          estimated_impact?: number | null
          id?: string
          resolved_at?: string | null
          severity: string
          status?: string
          type: string
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          description?: string
          estimated_impact?: number | null
          id?: string
          resolved_at?: string | null
          severity?: string
          status?: string
          type?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      coo_insight_reports: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          coo_analysis: Json
          created_at: string
          generated_at: string
          generated_by: string
          id: string
          lead_analysis: Json
          manager_analysis: Json
          pnl_snapshot_id: string | null
          updated_at: string
          week_end: string
          week_start: string
          worker_analysis: Json
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          coo_analysis: Json
          created_at?: string
          generated_at?: string
          generated_by: string
          id?: string
          lead_analysis: Json
          manager_analysis: Json
          pnl_snapshot_id?: string | null
          updated_at?: string
          week_end: string
          week_start: string
          worker_analysis: Json
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          coo_analysis?: Json
          created_at?: string
          generated_at?: string
          generated_by?: string
          id?: string
          lead_analysis?: Json
          manager_analysis?: Json
          pnl_snapshot_id?: string | null
          updated_at?: string
          week_end?: string
          week_start?: string
          worker_analysis?: Json
        }
        Relationships: [
          {
            foreignKeyName: "coo_insight_reports_pnl_snapshot_id_fkey"
            columns: ["pnl_snapshot_id"]
            isOneToOne: false
            referencedRelation: "pnl_weekly_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      deduction_types: {
        Row: {
          active: boolean
          auto_recurring: boolean
          code: string | null
          created_at: string | null
          description: string | null
          id: string
          installmentable: boolean
          name: string
          recurring_amount: number
          trigger_frequency: string | null
        }
        Insert: {
          active?: boolean
          auto_recurring?: boolean
          code?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          installmentable?: boolean
          name: string
          recurring_amount?: number
          trigger_frequency?: string | null
        }
        Update: {
          active?: boolean
          auto_recurring?: boolean
          code?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          installmentable?: boolean
          name?: string
          recurring_amount?: number
          trigger_frequency?: string | null
        }
        Relationships: []
      }
      delivery_records: {
        Row: {
          awb: string | null
          batch_id: string | null
          client_id: string | null
          created_at: string
          dash_delivery_id: string | null
          delivery_date: string
          delivery_type: string | null
          destination_address: string | null
          distance_km: number | null
          district: string | null
          driver_code: string | null
          fee: number
          id: string
          provider_order_id: string | null
          receiver_name: string | null
          rider_id: string | null
          sender_name: string | null
          service_type: string | null
          status: string | null
          weight_kg: number | null
        }
        Insert: {
          awb?: string | null
          batch_id?: string | null
          client_id?: string | null
          created_at?: string
          dash_delivery_id?: string | null
          delivery_date: string
          delivery_type?: string | null
          destination_address?: string | null
          distance_km?: number | null
          district?: string | null
          driver_code?: string | null
          fee?: number
          id?: string
          provider_order_id?: string | null
          receiver_name?: string | null
          rider_id?: string | null
          sender_name?: string | null
          service_type?: string | null
          status?: string | null
          weight_kg?: number | null
        }
        Update: {
          awb?: string | null
          batch_id?: string | null
          client_id?: string | null
          created_at?: string
          dash_delivery_id?: string | null
          delivery_date?: string
          delivery_type?: string | null
          destination_address?: string | null
          distance_km?: number | null
          district?: string | null
          driver_code?: string | null
          fee?: number
          id?: string
          provider_order_id?: string | null
          receiver_name?: string | null
          rider_id?: string | null
          sender_name?: string | null
          service_type?: string | null
          status?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_records_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_records_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_records_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_calculation_audit_log: {
        Row: {
          action: string
          affected_row_ids: Json | null
          calc_table: string | null
          client_id: string | null
          committed_by: string | null
          created_at: string
          id: string
          period_end: string
          period_start: string
          rejected_at: string | null
          rejected_by: string | null
          row_count: number
          scheme_id: string | null
          scheme_name: string | null
          scheme_snapshot: Json
          total_amount: number
        }
        Insert: {
          action: string
          affected_row_ids?: Json | null
          calc_table?: string | null
          client_id?: string | null
          committed_by?: string | null
          created_at?: string
          id?: string
          period_end: string
          period_start: string
          rejected_at?: string | null
          rejected_by?: string | null
          row_count: number
          scheme_id?: string | null
          scheme_name?: string | null
          scheme_snapshot: Json
          total_amount: number
        }
        Update: {
          action?: string
          affected_row_ids?: Json | null
          calc_table?: string | null
          client_id?: string | null
          committed_by?: string | null
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
          rejected_at?: string | null
          rejected_by?: string | null
          row_count?: number
          scheme_id?: string | null
          scheme_name?: string | null
          scheme_snapshot?: Json
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "fee_calculation_audit_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_calculation_audit_log_scheme_id_fkey"
            columns: ["scheme_id"]
            isOneToOne: false
            referencedRelation: "pricing_schemes"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_details: {
        Row: {
          base_amount: number
          calculation_type: string | null
          client_id: string
          component_label: string | null
          created_at: string
          detail_breakdown: Json | null
          id: string
          invoice_date: string
          invoice_no: string | null
          period_end: string | null
          period_start: string | null
          rider_id: string | null
          scheme_name: string | null
          status: string
          surcharge_amount: number
          total_amount: number
          upload_batch_id: string | null
        }
        Insert: {
          base_amount?: number
          calculation_type?: string | null
          client_id: string
          component_label?: string | null
          created_at?: string
          detail_breakdown?: Json | null
          id?: string
          invoice_date: string
          invoice_no?: string | null
          period_end?: string | null
          period_start?: string | null
          rider_id?: string | null
          scheme_name?: string | null
          status?: string
          surcharge_amount?: number
          total_amount?: number
          upload_batch_id?: string | null
        }
        Update: {
          base_amount?: number
          calculation_type?: string | null
          client_id?: string
          component_label?: string | null
          created_at?: string
          detail_breakdown?: Json | null
          id?: string
          invoice_date?: string
          invoice_no?: string | null
          period_end?: string | null
          period_start?: string | null
          rider_id?: string | null
          scheme_name?: string | null
          status?: string
          surcharge_amount?: number
          total_amount?: number
          upload_batch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_details_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_details_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_details_upload_batch_id_fkey"
            columns: ["upload_batch_id"]
            isOneToOne: false
            referencedRelation: "upload_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_deductions: {
        Row: {
          amount: number
          created_at: string
          deduction_type_id: string | null
          description: string | null
          detail_id: string | null
          id: string
          installment_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          deduction_type_id?: string | null
          description?: string | null
          detail_id?: string | null
          id?: string
          installment_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          deduction_type_id?: string | null
          description?: string | null
          detail_id?: string | null
          id?: string
          installment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_deductions_deduction_type_id_fkey"
            columns: ["deduction_type_id"]
            isOneToOne: false
            referencedRelation: "deduction_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_deductions_detail_id_fkey"
            columns: ["detail_id"]
            isOneToOne: false
            referencedRelation: "payroll_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_deductions_detail_id_fkey"
            columns: ["detail_id"]
            isOneToOne: false
            referencedRelation: "report_summary_weekly"
            referencedColumns: ["detail_id"]
          },
          {
            foreignKeyName: "payroll_deductions_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "rider_installments"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_details: {
        Row: {
          attendance_fee: number
          client_id: string | null
          created_at: string
          delivery_count: number
          delivery_fee: number
          gross_earning: number
          id: string
          incentive: number
          net_pay: number
          penalty: number
          remarks: string | null
          rider_id: string | null
          run_id: string | null
          total_deduction: number
        }
        Insert: {
          attendance_fee?: number
          client_id?: string | null
          created_at?: string
          delivery_count?: number
          delivery_fee?: number
          gross_earning?: number
          id?: string
          incentive?: number
          net_pay?: number
          penalty?: number
          remarks?: string | null
          rider_id?: string | null
          run_id?: string | null
          total_deduction?: number
        }
        Update: {
          attendance_fee?: number
          client_id?: string | null
          created_at?: string
          delivery_count?: number
          delivery_fee?: number
          gross_earning?: number
          id?: string
          incentive?: number
          net_pay?: number
          penalty?: number
          remarks?: string | null
          rider_id?: string | null
          run_id?: string | null
          total_deduction?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_details_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_details_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_details_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_reminder_log: {
        Row: {
          created_at: string
          due_clients: Json
          due_riders: Json
          id: string
          push_status: Json
          reminder_date: string
          triggered_by: string
          triggered_by_user: string | null
        }
        Insert: {
          created_at?: string
          due_clients?: Json
          due_riders?: Json
          id?: string
          push_status: Json
          reminder_date: string
          triggered_by: string
          triggered_by_user?: string | null
        }
        Update: {
          created_at?: string
          due_clients?: Json
          due_riders?: Json
          id?: string
          push_status?: Json
          reminder_date?: string
          triggered_by?: string
          triggered_by_user?: string | null
        }
        Relationships: []
      }
      payroll_reminder_schedules: {
        Row: {
          active: boolean
          client_id: string | null
          close_same_day: boolean
          created_at: string
          id: string
          label: string
          period_end_weekday: number | null
          period_start_weekday: number | null
          rider_id: string | null
          updated_at: string
          weekdays: number[]
        }
        Insert: {
          active?: boolean
          client_id?: string | null
          close_same_day?: boolean
          created_at?: string
          id?: string
          label: string
          period_end_weekday?: number | null
          period_start_weekday?: number | null
          rider_id?: string | null
          updated_at?: string
          weekdays: number[]
        }
        Update: {
          active?: boolean
          client_id?: string | null
          close_same_day?: boolean
          created_at?: string
          id?: string
          label?: string
          period_end_weekday?: number | null
          period_start_weekday?: number | null
          rider_id?: string | null
          updated_at?: string
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "payroll_reminder_schedules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_reminder_schedules_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          client_id: string | null
          created_at: string
          finalized_at: string | null
          id: string
          name: string
          period_end: string
          period_start: string
          period_type: string
          published_at: string | null
          status: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          finalized_at?: string | null
          id?: string
          name: string
          period_end: string
          period_start: string
          period_type?: string
          published_at?: string | null
          status?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          finalized_at?: string | null
          id?: string
          name?: string
          period_end?: string
          period_start?: string
          period_type?: string
          published_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_workflow_runs: {
        Row: {
          created_at: string
          error: string | null
          finished_at: string
          id: string
          result: Json
          started_at: string
          status: string
          trigger_type: string
          triggered_by: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          finished_at: string
          id?: string
          result?: Json
          started_at: string
          status: string
          trigger_type: string
          triggered_by: string
        }
        Update: {
          created_at?: string
          error?: string | null
          finished_at?: string
          id?: string
          result?: Json
          started_at?: string
          status?: string
          trigger_type?: string
          triggered_by?: string
        }
        Relationships: []
      }
      payslips: {
        Row: {
          data: Json
          detail_id: string | null
          id: string
          published_at: string
          rider_id: string | null
          run_id: string | null
        }
        Insert: {
          data?: Json
          detail_id?: string | null
          id?: string
          published_at?: string
          rider_id?: string | null
          run_id?: string | null
        }
        Update: {
          data?: Json
          detail_id?: string | null
          id?: string
          published_at?: string
          rider_id?: string | null
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payslips_detail_id_fkey"
            columns: ["detail_id"]
            isOneToOne: true
            referencedRelation: "payroll_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_detail_id_fkey"
            columns: ["detail_id"]
            isOneToOne: true
            referencedRelation: "report_summary_weekly"
            referencedColumns: ["detail_id"]
          },
          {
            foreignKeyName: "payslips_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      pnl_weekly_snapshots: {
        Row: {
          computed_at: string
          created_at: string
          id: string
          per_client: Json
          push_status: Json
          total_cost: number
          total_margin: number
          total_margin_pct: number
          total_revenue: number
          triggered_by: string
          triggered_by_user: string | null
          week_end: string
          week_start: string
        }
        Insert: {
          computed_at?: string
          created_at?: string
          id?: string
          per_client?: Json
          push_status?: Json
          total_cost?: number
          total_margin?: number
          total_margin_pct?: number
          total_revenue?: number
          triggered_by?: string
          triggered_by_user?: string | null
          week_end: string
          week_start: string
        }
        Update: {
          computed_at?: string
          created_at?: string
          id?: string
          per_client?: Json
          push_status?: Json
          total_cost?: number
          total_margin?: number
          total_margin_pct?: number
          total_revenue?: number
          triggered_by?: string
          triggered_by_user?: string | null
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      pricing_schemes: {
        Row: {
          calc_type: string | null
          client_id: string | null
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          name: string
          params: Json | null
          scheme_for: string
        }
        Insert: {
          calc_type?: string | null
          client_id?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          name: string
          params?: Json | null
          scheme_for?: string
        }
        Update: {
          calc_type?: string | null
          client_id?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          name?: string
          params?: Json | null
          scheme_for?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_schemes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          employee_id: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          employee_id?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          employee_id?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      rider_attendance_rules: {
        Row: {
          attendance_rule_id: string | null
          effective_from: string
          effective_to: string | null
          id: string
          rider_id: string | null
        }
        Insert: {
          attendance_rule_id?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          rider_id?: string | null
        }
        Update: {
          attendance_rule_id?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          rider_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rider_attendance_rules_attendance_rule_id_fkey"
            columns: ["attendance_rule_id"]
            isOneToOne: false
            referencedRelation: "attendance_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_installments: {
        Row: {
          active: boolean
          created_at: string
          daily_rate: number | null
          deduction_type_id: string | null
          id: string
          installment_count: number | null
          installments_paid: number
          mode: string
          next_deduction_date: string | null
          notes: string | null
          per_period_amount: number | null
          rider_id: string
          start_date: string
          total_amount: number | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          daily_rate?: number | null
          deduction_type_id?: string | null
          id?: string
          installment_count?: number | null
          installments_paid?: number
          mode?: string
          next_deduction_date?: string | null
          notes?: string | null
          per_period_amount?: number | null
          rider_id: string
          start_date?: string
          total_amount?: number | null
        }
        Update: {
          active?: boolean
          created_at?: string
          daily_rate?: number | null
          deduction_type_id?: string | null
          id?: string
          installment_count?: number | null
          installments_paid?: number
          mode?: string
          next_deduction_date?: string | null
          notes?: string | null
          per_period_amount?: number | null
          rider_id?: string
          start_date?: string
          total_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rider_installments_deduction_type_id_fkey"
            columns: ["deduction_type_id"]
            isOneToOne: false
            referencedRelation: "deduction_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_installments_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      riders: {
        Row: {
          bank_account: string | null
          bank_account_holder: string | null
          bank_account_number: string | null
          bank_name: string | null
          birth_date: string | null
          birth_place: string | null
          client_id: string | null
          created_at: string
          email: string | null
          employee_id: string
          full_name: string
          id: string
          join_date: string | null
          must_change_pin: boolean
          nik: string | null
          notes: string | null
          phone: string | null
          phone_number: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          bank_account?: string | null
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          birth_date?: string | null
          birth_place?: string | null
          client_id?: string | null
          created_at?: string
          email?: string | null
          employee_id: string
          full_name: string
          id?: string
          join_date?: string | null
          must_change_pin?: boolean
          nik?: string | null
          notes?: string | null
          phone?: string | null
          phone_number?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          bank_account?: string | null
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          birth_date?: string | null
          birth_place?: string | null
          client_id?: string | null
          created_at?: string
          email?: string | null
          employee_id?: string
          full_name?: string
          id?: string
          join_date?: string | null
          must_change_pin?: boolean
          nik?: string | null
          notes?: string | null
          phone?: string | null
          phone_number?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "riders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_batches: {
        Row: {
          client_id: string | null
          created_at: string
          filename: string | null
          id: string
          kind: string
          row_count: number
          uploaded_by: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          filename?: string | null
          id?: string
          kind: string
          row_count?: number
          uploaded_by?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          filename?: string | null
          id?: string
          kind?: string
          row_count?: number
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "upload_batches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      report_summary_weekly: {
        Row: {
          attendance_fee: number | null
          bank_account: string | null
          bank_account_holder: string | null
          client_code: string | null
          client_id: string | null
          client_name: string | null
          delivery_count: number | null
          delivery_fee: number | null
          detail_id: string | null
          gross_earning: number | null
          incentive: number | null
          net_pay: number | null
          penalty: number | null
          period_end: string | null
          period_start: string | null
          period_type: string | null
          remarks: string | null
          rider_employee_id: string | null
          rider_id: string | null
          rider_name: string | null
          rider_phone: string | null
          run_id: string | null
          run_name: string | null
          run_published_at: string | null
          run_status: string | null
          total_deduction: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_details_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_details_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_details_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      area_at_point: {
        Args: {
          p_lat: number
          p_lng: number
        }
        Returns: string
      }
      has_role: {
        Args: {
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "superadmin" | "rider"
      calculation_type:
        | "NORMAL_AWB"
        | "ADDRESS_DEDUP"
        | "KM_BASED_TIERED"
        | "KM_BASED_PER_ORDER"
        | "DAILY_OTP"
      case_status: "open" | "approved" | "rejected" | "closed"
      deduction_status: "pending" | "deducted" | "cancelled"
      dispatch_status: "DELIVERED" | "FAILED" | "RETURNED" | "PENDING"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "superadmin", "rider"],
      calculation_type: [
        "NORMAL_AWB",
        "ADDRESS_DEDUP",
        "KM_BASED_TIERED",
        "KM_BASED_PER_ORDER",
        "DAILY_OTP",
      ],
      case_status: ["open", "approved", "rejected", "closed"],
      deduction_status: ["pending", "deducted", "cancelled"],
      dispatch_status: ["DELIVERED", "FAILED", "RETURNED", "PENDING"],
    },
  },
} as const
