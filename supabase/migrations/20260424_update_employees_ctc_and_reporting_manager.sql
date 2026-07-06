/*
  # Update Employees Table - CTC and Reporting Manager

  ## Changes
  - Rename 'salary' column to 'ctc'
  - Add 'reporting_manager' column
*/

-- Add reporting_manager column
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS reporting_manager text DEFAULT '';

-- Rename salary to ctc if it exists
ALTER TABLE employees 
RENAME COLUMN salary TO ctc;

-- Update the employees table description/comment
COMMENT ON TABLE employees IS 'Employee records with personal, bank, statutory details, CTC, and reporting manager information';
