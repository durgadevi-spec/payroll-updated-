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
  bank_name: string;
  bank_account: string;
  ifsc_code: string;
  pf_number: string;
  esi_number: string;
  uan_number: string;
  status: 'active' | 'inactive';
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
}

export interface PayrollItem {
  id: string;
  payroll_id: string;
  employee_id: string;
  monthly_salary: number;
  leave_deduction: number;
  timesheet_deduction: number;
  pf_deduction: number;
  esi_deduction: number;
  tax_deduction: number;
  loan_deduction: number;
  bonus: number;
  net_salary: number;
  unpaid_leaves: number;
  missing_timesheets: number;
  holiday_count: number;
  working_days: number;
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
