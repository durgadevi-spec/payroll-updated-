ALTER TABLE public.payroll_items
  ADD COLUMN IF NOT EXISTS hourly_deduction_breakdown jsonb;
