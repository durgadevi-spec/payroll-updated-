-- Allow anonymous access for development
-- WARNING: This is for development only. In production, use proper authentication.

-- Drop existing policies and recreate for anonymous access
DROP POLICY IF EXISTS "Authenticated users can view employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can insert employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can update employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can delete employees" ON employees;

CREATE POLICY "Anonymous users can view employees"
  ON employees FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous users can insert employees"
  ON employees FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous users can update employees"
  ON employees FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anonymous users can delete employees"
  ON employees FOR DELETE
  TO anon
  USING (true);

-- Payrolls policies
DROP POLICY IF EXISTS "Authenticated users can view payrolls" ON payrolls;
DROP POLICY IF EXISTS "Authenticated users can insert payrolls" ON payrolls;
DROP POLICY IF EXISTS "Authenticated users can update payrolls" ON payrolls;
DROP POLICY IF EXISTS "Authenticated users can delete payrolls" ON payrolls;

CREATE POLICY "Anonymous users can view payrolls"
  ON payrolls FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous users can insert payrolls"
  ON payrolls FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous users can update payrolls"
  ON payrolls FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anonymous users can delete payrolls"
  ON payrolls FOR DELETE
  TO anon
  USING (true);

-- Payroll items policies
DROP POLICY IF EXISTS "Authenticated users can view payroll_items" ON payroll_items;
DROP POLICY IF EXISTS "Authenticated users can insert payroll_items" ON payroll_items;
DROP POLICY IF EXISTS "Authenticated users can update payroll_items" ON payroll_items;
DROP POLICY IF EXISTS "Authenticated users can delete payroll_items" ON payroll_items;

CREATE POLICY "Anonymous users can view payroll_items"
  ON payroll_items FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous users can insert payroll_items"
  ON payroll_items FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous users can update payroll_items"
  ON payroll_items FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anonymous users can delete payroll_items"
  ON payroll_items FOR DELETE
  TO anon
  USING (true);

-- Payslips policies
DROP POLICY IF EXISTS "Authenticated users can view payslips" ON payslips;
DROP POLICY IF EXISTS "Authenticated users can insert payslips" ON payslips;
DROP POLICY IF EXISTS "Authenticated users can update payslips" ON payslips;
DROP POLICY IF EXISTS "Authenticated users can delete payslips" ON payslips;

CREATE POLICY "Anonymous users can view payslips"
  ON payslips FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous users can insert payslips"
  ON payslips FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous users can update payslips"
  ON payslips FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anonymous users can delete payslips"
  ON payslips FOR DELETE
  TO anon
  USING (true);

-- Leaves policies
DROP POLICY IF EXISTS "Authenticated users can view leaves" ON leaves;
DROP POLICY IF EXISTS "Authenticated users can insert leaves" ON leaves;
DROP POLICY IF EXISTS "Authenticated users can update leaves" ON leaves;
DROP POLICY IF EXISTS "Authenticated users can delete leaves" ON leaves;

CREATE POLICY "Anonymous users can view leaves"
  ON leaves FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous users can insert leaves"
  ON leaves FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous users can update leaves"
  ON leaves FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anonymous users can delete leaves"
  ON leaves FOR DELETE
  TO anon
  USING (true);

-- Timesheets policies
DROP POLICY IF EXISTS "Authenticated users can view timesheets" ON timesheets;
DROP POLICY IF EXISTS "Authenticated users can insert timesheets" ON timesheets;
DROP POLICY IF EXISTS "Authenticated users can update timesheets" ON timesheets;
DROP POLICY IF EXISTS "Authenticated users can delete timesheets" ON timesheets;

CREATE POLICY "Anonymous users can view timesheets"
  ON timesheets FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous users can insert timesheets"
  ON timesheets FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous users can update timesheets"
  ON timesheets FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anonymous users can delete timesheets"
  ON timesheets FOR DELETE
  TO anon
  USING (true);

-- Bonuses policies
DROP POLICY IF EXISTS "Authenticated users can view bonuses" ON bonuses;
DROP POLICY IF EXISTS "Authenticated users can insert bonuses" ON bonuses;
DROP POLICY IF EXISTS "Authenticated users can update bonuses" ON bonuses;
DROP POLICY IF EXISTS "Authenticated users can delete bonuses" ON bonuses;

CREATE POLICY "Anonymous users can view bonuses"
  ON bonuses FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous users can insert bonuses"
  ON bonuses FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous users can update bonuses"
  ON bonuses FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anonymous users can delete bonuses"
  ON bonuses FOR DELETE
  TO anon
  USING (true);

-- Settings policies
DROP POLICY IF EXISTS "Authenticated users can view settings" ON settings;
DROP POLICY IF EXISTS "Authenticated users can insert settings" ON settings;
DROP POLICY IF EXISTS "Authenticated users can update settings" ON settings;
DROP POLICY IF EXISTS "Authenticated users can delete settings" ON settings;

CREATE POLICY "Anonymous users can view settings"
  ON settings FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous users can insert settings"
  ON settings FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous users can update settings"
  ON settings FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anonymous users can delete settings"
  ON settings FOR DELETE
  TO anon
  USING (true);

-- Email logs policies
DROP POLICY IF EXISTS "Authenticated users can view email_logs" ON email_logs;
DROP POLICY IF EXISTS "Authenticated users can insert email_logs" ON email_logs;
DROP POLICY IF EXISTS "Authenticated users can update email_logs" ON email_logs;
DROP POLICY IF EXISTS "Authenticated users can delete email_logs" ON email_logs;

CREATE POLICY "Anonymous users can view email_logs"
  ON email_logs FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous users can insert email_logs"
  ON email_logs FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous users can update email_logs"
  ON email_logs FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anonymous users can delete email_logs"
  ON email_logs FOR DELETE
  TO anon
  USING (true);

-- Audit logs policies (insert-only)
DROP POLICY IF EXISTS "Authenticated users can view audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert audit_logs" ON audit_logs;

CREATE POLICY "Anonymous users can view audit_logs"
  ON audit_logs FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous users can insert audit_logs"
  ON audit_logs FOR INSERT
  TO anon
  WITH CHECK (true);