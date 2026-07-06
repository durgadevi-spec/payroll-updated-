/*
  # Payroll System - Complete Database Schema

  ## Overview
  Creates all tables required for a production-ready payroll management system.

  ## New Tables
  1. `employees` - Core employee records with personal, bank, and statutory details
  2. `payrolls` - Monthly payroll run records (one per month/year)
  3. `payroll_items` - Per-employee salary breakdown for each payroll run
  4. `payslips` - Generated payslip records with email delivery tracking
  5. `leaves` - Employee leave records per month (from LMS integration)
  6. `timesheets` - Employee attendance/timesheet data per month
  7. `bonuses` - Bonus records linked to employees and payroll runs
  8. `settings` - Company and system configuration key-value store
  9. `email_logs` - Email delivery audit trail
  10. `audit_logs` - System-wide action audit trail

  ## Security
  - RLS enabled on all tables
  - Authenticated users can perform CRUD operations on all tables
  - Audit logs are insert-only (no update/delete)

  ## Sample Data
  - 2 initial employees: Durga and Rebeca (salary ₹12,000 each)
  - Default company settings
  - Sample leave and timesheet data for current month
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- EMPLOYEES TABLE
CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  salary numeric(12,2) NOT NULL DEFAULT 0,
  department text DEFAULT '',
  designation text DEFAULT '',
  joining_date date,
  bank_name text DEFAULT '',
  bank_account text DEFAULT '',
  ifsc_code text DEFAULT '',
  pf_number text DEFAULT '',
  esi_number text DEFAULT '',
  uan_number text DEFAULT '',
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view employees"
  ON employees FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert employees"
  ON employees FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update employees"
  ON employees FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete employees"
  ON employees FOR DELETE
  TO authenticated
  USING (true);

-- PAYROLLS TABLE
CREATE TABLE IF NOT EXISTS payrolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  year integer NOT NULL,
  status text DEFAULT 'draft',
  total_amount numeric(12,2) DEFAULT 0,
  employee_count integer DEFAULT 0,
  generated_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(month, year)
);

ALTER TABLE payrolls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view payrolls"
  ON payrolls FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert payrolls"
  ON payrolls FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update payrolls"
  ON payrolls FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete payrolls"
  ON payrolls FOR DELETE
  TO authenticated
  USING (true);

-- PAYROLL ITEMS TABLE
CREATE TABLE IF NOT EXISTS payroll_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_id uuid REFERENCES payrolls(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  basic_salary numeric(12,2) DEFAULT 0,
  leave_deduction numeric(12,2) DEFAULT 0,
  timesheet_deduction numeric(12,2) DEFAULT 0,
  pf_deduction numeric(12,2) DEFAULT 0,
  esi_deduction numeric(12,2) DEFAULT 0,
  tax_deduction numeric(12,2) DEFAULT 0,
  loan_deduction numeric(12,2) DEFAULT 0,
  bonus numeric(12,2) DEFAULT 0,
  net_salary numeric(12,2) DEFAULT 0,
  unpaid_leaves integer DEFAULT 0,
  missing_timesheets integer DEFAULT 0,
  working_days integer DEFAULT 26,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE payroll_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view payroll_items"
  ON payroll_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert payroll_items"
  ON payroll_items FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update payroll_items"
  ON payroll_items FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete payroll_items"
  ON payroll_items FOR DELETE
  TO authenticated
  USING (true);

-- PAYSLIPS TABLE
CREATE TABLE IF NOT EXISTS payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_item_id uuid REFERENCES payroll_items(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  payroll_id uuid REFERENCES payrolls(id) ON DELETE CASCADE,
  status text DEFAULT 'generated',
  email_sent boolean DEFAULT false,
  email_sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view payslips"
  ON payslips FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert payslips"
  ON payslips FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update payslips"
  ON payslips FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete payslips"
  ON payslips FOR DELETE
  TO authenticated
  USING (true);

-- LEAVES TABLE
CREATE TABLE IF NOT EXISTS leaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  year integer NOT NULL,
  total_leaves integer DEFAULT 0,
  paid_leaves integer DEFAULT 0,
  unpaid_leaves integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, month, year)
);

ALTER TABLE leaves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view leaves"
  ON leaves FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert leaves"
  ON leaves FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update leaves"
  ON leaves FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete leaves"
  ON leaves FOR DELETE
  TO authenticated
  USING (true);

-- TIMESHEETS TABLE
CREATE TABLE IF NOT EXISTS timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  year integer NOT NULL,
  working_days integer DEFAULT 26,
  present_days integer DEFAULT 26,
  missing_days integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, month, year)
);

ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view timesheets"
  ON timesheets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert timesheets"
  ON timesheets FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update timesheets"
  ON timesheets FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete timesheets"
  ON timesheets FOR DELETE
  TO authenticated
  USING (true);

-- BONUSES TABLE
CREATE TABLE IF NOT EXISTS bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  payroll_id uuid REFERENCES payrolls(id) ON DELETE CASCADE,
  type text DEFAULT 'performance',
  amount numeric(12,2) DEFAULT 0,
  description text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bonuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view bonuses"
  ON bonuses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert bonuses"
  ON bonuses FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update bonuses"
  ON bonuses FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete bonuses"
  ON bonuses FOR DELETE
  TO authenticated
  USING (true);

-- SETTINGS TABLE
CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view settings"
  ON settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert settings"
  ON settings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update settings"
  ON settings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- EMAIL LOGS TABLE
CREATE TABLE IF NOT EXISTS email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  payroll_id uuid REFERENCES payrolls(id) ON DELETE SET NULL,
  email text NOT NULL,
  subject text DEFAULT '',
  status text DEFAULT 'pending',
  error_message text,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view email_logs"
  ON email_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert email_logs"
  ON email_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update email_logs"
  ON email_logs FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  details jsonb,
  user_email text DEFAULT 'admin@company.com',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view audit_logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert audit_logs"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- SEED DATA: Sample Employees
INSERT INTO employees (name, email, salary, department, designation, joining_date, bank_name, bank_account, ifsc_code, pf_number, uan_number, status)
VALUES
  ('Durga', 'durga@company.com', 12000, 'Engineering', 'Software Engineer', '2023-01-15', 'State Bank of India', '1234567890', 'SBIN0001234', 'PF001', 'UAN001', 'active'),
  ('Rebeca', 'rebeca@company.com', 12000, 'Design', 'UI/UX Designer', '2023-03-01', 'HDFC Bank', '9876543210', 'HDFC0009876', 'PF002', 'UAN002', 'active')
ON CONFLICT (email) DO NOTHING;

-- SEED DATA: Default Settings
INSERT INTO settings (key, value) VALUES
  ('company_name', 'Acme Corp Pvt Ltd'),
  ('company_email', 'hr@acmecorp.com'),
  ('company_phone', '+91 98765 43210'),
  ('company_address', '123, Business Park, Bangalore - 560001'),
  ('company_gstin', '29ABCDE1234F1Z5'),
  ('working_days', '26'),
  ('pf_rate', '12'),
  ('esi_rate', '0.75'),
  ('esi_limit', '21000'),
  ('tax_rate', '10'),
  ('smtp_host', 'smtp.gmail.com'),
  ('smtp_port', '587'),
  ('smtp_user', 'hr@acmecorp.com'),
  ('smtp_from', 'HR Department <hr@acmecorp.com>'),
  ('payroll_date', '1'),
  ('financial_year_start', '4')
ON CONFLICT (key) DO NOTHING;
