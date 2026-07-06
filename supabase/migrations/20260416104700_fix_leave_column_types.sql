-- Fix column types in payroll_items to support fractional leaves (e.g., 0.5 days)
ALTER TABLE payroll_items ALTER COLUMN unpaid_leaves TYPE numeric;
ALTER TABLE payroll_items ALTER COLUMN missing_timesheets TYPE numeric;
