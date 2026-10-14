DO $$
BEGIN
  IF to_regclass('public.employees') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'employees'
         AND column_name = 'ctc'
     ) THEN
    ALTER TABLE public.employees
      ADD COLUMN IF NOT EXISTS site_location text DEFAULT '';
  END IF;
END
$$;
