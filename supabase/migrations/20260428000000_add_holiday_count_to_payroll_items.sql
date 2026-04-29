-- Add holiday_count column to payroll_items table
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS holiday_count integer DEFAULT 0;
