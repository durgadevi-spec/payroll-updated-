export interface Employee {
  id: string;
  name: string;
  email: string;
  employee_code?: string;
  ctc: number;
  reporting_manager: string;
  department: string;
  designation: string;
  joining_date: string | null;
  relieving_date: string | null;
  bank_name: string;
  bank_account: string;
  ifsc_code: string;
  pf_number: string;
  esi_number: string;
  uan_number: string;
  status: 'active' | 'inactive';
  use_pa_sla?: boolean;
  pa_sla_balance?: number;
  created_at: string;
  updated_at: string;
}

export interface Payroll {
  id: string;
  month: number;
  year: number;
  status: 'draft' | 'processing' | 'completed' | 'paid';
  total_amount: number;
  employee_count: number;
  generated_at: string | null;
  paid_at: string | null;
  created_at: string;
  version?: number;
  regeneration_reason?: string | null;
}

export interface PayrollItem {
  id: string;
  payroll_id: string;
  employee_id: string;
  monthly_salary: number;
  leave_deduction: number;
  timesheet_deduction: number;
  missing_punches?: number;
  missing_punch_deduction?: number;
  missing_punch_dates?: string[];
  // Missing Punch Exception: admin-granted, per-date waiver of the missing-punch deduction
  missing_punch_exception_dates?: string[];
  missing_punch_exception_note?: string | null;
  missing_punch_exception_granted_at?: string | null;
  pf_deduction: number;
  esi_deduction: number;
  tax_deduction: number;
  loan_deduction: number;
  advance_deduction?: number;
  bonus: number;
  // Balance amount carried forward/still owed from a previous month's salary
  // (e.g. salary that was partially paid or held back last month). Added on
  // top of this month's earnings, shown separately as "Previous Month Balance".
  previous_month_balance?: number;
  net_salary: number;
  unpaid_leaves: number;
  total_leaves?: number;
  paid_leaves?: number;
  sunday_work_days?: number;
  missing_timesheets: number;
  holiday_count: number;
  working_days: number;
  pa_sla_consumed?: number;
  timesheet_excluded_dates?: string[];
  holiday_dates?: string[];
  // Timesheet Exception: admin-granted waiver of the missing-timesheet deduction
  timesheet_exception_type?: 'none' | 'full' | 'partial';
  timesheet_exception_days?: number;
  timesheet_exception_note?: string | null;
  timesheet_exception_granted_at?: string | null;
  timesheet_exception_days_applied?: number;
  calculation_type?: 'monthly' | 'custom' | 'working_days';
  calculation_days?: number;
  permission_hours?: number;
  permission_deduction?: number;
  hourly_short_hours?: number;
  hourly_deduction?: number;
  created_at: string;
  employee?: Employee;
}

export interface Payslip {
  id: string;
  payroll_item_id: string;
  employee_id: string;
  payroll_id: string;
  status: string;
  email_sent: boolean;
  email_sent_at: string | null;
  created_at: string;
  employee?: Employee;
  payroll?: Payroll;
  payroll_item?: PayrollItem;
}

export interface PayslipFull {
  id: string;
  payroll_id: string;
  employee_id: string;
  status: string;
  email_sent: boolean;
  email_sent_at: string | null;
  created_at: string;
  employee: Pick<Employee, 'id' | 'name' | 'email' | 'designation' | 'department' | 'bank_account' | 'pf_number' | 'uan_number'>;
  payroll: {
    id: string;
    month: number;
    year: number;
    status: string;
  };
  payroll_item: Pick<PayrollItem, 'id' | 'employee_id' | 'monthly_salary' | 'leave_deduction' | 'timesheet_deduction' | 'pf_deduction' | 'esi_deduction' | 'tax_deduction' | 'loan_deduction' | 'bonus' | 'net_salary' | 'working_days' | 'unpaid_leaves'> & {
    advance_deduction?: number;
    sunday_work_days?: number;
    previous_month_balance?: number;
    calculation_type?: PayrollItem['calculation_type'];
    calculation_days?: number;
  };
}

export interface Leave {
  id: string;
  employee_id: string;
  month: number;
  year: number;
  total_leaves: number;
  paid_leaves: number;
  unpaid_leaves: number;
  created_at: string;
}

export interface Timesheet {
  id: string;
  employee_id: string;
  month: number;
  year: number;
  working_days: number;
  present_days: number;
  missing_days: number;
  created_at: string;
}

export interface Bonus {
  id: string;
  employee_id: string;
  payroll_id: string;
  type: string;
  amount: number;
  description: string;
  created_at: string;
}

export interface Setting {
  id: string;
  key: string;
  value: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailLog {
  id: string;
  employee_id: string | null;
  payroll_id: string | null;
  email: string;
  subject: string;
  status: 'pending' | 'sent' | 'failed';
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  user_email: string;
  created_at: string;
}

export type Page =
  | 'dashboard'
  | 'daily-analysis'
  | 'employees'
  | 'attendance'
  | 'payroll'
  | 'advance-management'
  | 'payslips'
  | 'reports'
  | 'settings'
  | 'email-logs'
  | 'audit-logs'
  | 'signup';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}