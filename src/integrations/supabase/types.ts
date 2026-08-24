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
      area_boundaries: {
        Row: {
          geom: unknown
          id: string
          name: string
        }
        Insert: {
          geom: unknown
          id?: string
          name: string
        }
        Update: {
          geom?: unknown
          id?: string
          name?: string
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
          pitstop_name: string | null
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
          pitstop_name?: string | null
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
          pitstop_name?: string | null
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
          contract: string | null
          created_at: string | null
          id: string
          name: string
          phone: string | null
          project_name: string | null
          provider_id: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          code: string
          contact_person?: string | null
          contract?: string | null
          created_at?: string | null
          id?: string
          name: string
          phone?: string | null
          project_name?: string | null
          provider_id?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          code?: string
          contact_person?: string | null
          contract?: string | null
          created_at?: string | null
          id?: string
          name?: string
          phone?: string | null
          project_name?: string | null
          provider_id?: number | null
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
          generated_by?: string
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
      deduction_type_riders: {
        Row: {
          client_id: string | null
          created_at: string
          deduction_type_id: string
          id: string
          rider_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          deduction_type_id: string
          id?: string
          rider_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          deduction_type_id?: string
          id?: string
          rider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deduction_type_riders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deduction_type_riders_deduction_type_id_fkey"
            columns: ["deduction_type_id"]
            isOneToOne: false
            referencedRelation: "deduction_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deduction_type_riders_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      deduction_types: {
        Row: {
          active: boolean
          applies_to_all: boolean
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
          applies_to_all?: boolean
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
          applies_to_all?: boolean
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
          destination_lat: number | null
          destination_lng: number | null
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
          destination_lat?: number | null
          destination_lng?: number | null
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
          destination_lat?: number | null
          destination_lng?: number | null
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
      molis_types: {
        Row: {
          active: boolean
          created_at: string
          default_daily_rate: number
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          default_daily_rate?: number
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          default_daily_rate?: number
          id?: string
          name?: string
        }
        Relationships: []
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
          paid_amount: number | null
        }
        Insert: {
          amount?: number
          created_at?: string
          deduction_type_id?: string | null
          description?: string | null
          detail_id?: string | null
          id?: string
          installment_id?: string | null
          paid_amount?: number | null
        }
        Update: {
          amount?: number
          created_at?: string
          deduction_type_id?: string | null
          description?: string | null
          detail_id?: string | null
          id?: string
          installment_id?: string | null
          paid_amount?: number | null
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
      payroll_incentives: {
        Row: {
          amount: number
          created_at: string
          description: string
          detail_id: string | null
          id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          description: string
          detail_id?: string | null
          id?: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          detail_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_incentives_detail_id_fkey"
            columns: ["detail_id"]
            isOneToOne: false
            referencedRelation: "payroll_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_incentives_detail_id_fkey"
            columns: ["detail_id"]
            isOneToOne: false
            referencedRelation: "report_summary_weekly"
            referencedColumns: ["detail_id"]
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
          run_time: string | null
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
          run_time?: string | null
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
          run_time?: string | null
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
          charge_target: string
          client_id: string | null
          created_at: string
          cycle_start_day: number | null
          daily_rate: number | null
          deduction_type_id: string | null
          id: string
          installment_count: number | null
          installments_paid: number
          mode: string
          molis_type_id: string | null
          next_deduction_date: string | null
          notes: string | null
          per_period_amount: number | null
          rider_id: string
          start_date: string
          total_amount: number | null
        }
        Insert: {
          active?: boolean
          charge_target?: string
          client_id?: string | null
          created_at?: string
          cycle_start_day?: number | null
          daily_rate?: number | null
          deduction_type_id?: string | null
          id?: string
          installment_count?: number | null
          installments_paid?: number
          mode?: string
          molis_type_id?: string | null
          next_deduction_date?: string | null
          notes?: string | null
          per_period_amount?: number | null
          rider_id: string
          start_date?: string
          total_amount?: number | null
        }
        Update: {
          active?: boolean
          charge_target?: string
          client_id?: string | null
          created_at?: string
          cycle_start_day?: number | null
          daily_rate?: number | null
          deduction_type_id?: string | null
          id?: string
          installment_count?: number | null
          installments_paid?: number
          mode?: string
          molis_type_id?: string | null
          next_deduction_date?: string | null
          notes?: string | null
          per_period_amount?: number | null
          rider_id?: string
          start_date?: string
          total_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rider_installments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_installments_deduction_type_id_fkey"
            columns: ["deduction_type_id"]
            isOneToOne: false
            referencedRelation: "deduction_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_installments_molis_type_id_fkey"
            columns: ["molis_type_id"]
            isOneToOne: false
            referencedRelation: "molis_types"
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
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
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
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
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
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      area_at_point: { Args: { p_lat: number; p_lng: number }; Returns: string }
      change_user_role: {
        Args: { new_role: string; target_uid: string }
        Returns: undefined
      }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      gettransactionid: { Args: never; Returns: unknown }
      has_role: {
        Args: {
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: boolean
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      regenerate_payroll_details: {
        Args: { p_deductions?: Json; p_details?: Json; p_run_id: string }
        Returns: undefined
      }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
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
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
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
