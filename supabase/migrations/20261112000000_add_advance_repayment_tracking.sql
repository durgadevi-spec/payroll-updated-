DO $$
DECLARE
  payroll_row RECORD;
  target_advance RECORD;
  remaining_recoverable NUMERIC(10, 2);
  amount_to_record NUMERIC(10, 2);
BEGIN
  IF to_regclass('public.advances') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS public.advance_repayments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      advance_id UUID NOT NULL REFERENCES public.advances(id) ON DELETE CASCADE,
      repayment_month DATE,
      amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
      is_legacy BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT advance_repayments_month_start CHECK (EXTRACT(DAY FROM repayment_month) = 1),
      CONSTRAINT advance_repayments_one_per_month UNIQUE (advance_id, repayment_month)
    );

    ALTER TABLE public.advance_repayments ALTER COLUMN repayment_month DROP NOT NULL;

    DELETE FROM public.advance_repayments
    WHERE is_legacy
      AND notes = 'Historical balance carried forward when repayment tracking was enabled';

    DELETE FROM public.advance_repayments legacy
    WHERE legacy.is_legacy
      AND legacy.notes = 'Historical repayments not attributable to a payroll month; preserved from the previous balance'
      AND EXISTS (
        SELECT 1
        FROM public.advance_repayments payroll_repayment
        WHERE payroll_repayment.advance_id = legacy.advance_id
          AND payroll_repayment.notes LIKE 'Seeded from paid payroll deduction; assigned to oldest advance only%'
      );

    IF to_regclass('public.payroll_items') IS NOT NULL
      AND to_regclass('public.payrolls') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.advance_repayments
        WHERE notes LIKE 'Seeded from paid payroll deduction; assigned to oldest advance only%'
      )
    THEN
      CREATE TEMP TABLE advance_repayment_backfill_state (
        advance_id UUID PRIMARY KEY,
        employee_id UUID NOT NULL,
        advance_date DATE NOT NULL,
        recoverable_limit NUMERIC(10, 2) NOT NULL,
        already_recorded NUMERIC(10, 2) NOT NULL DEFAULT 0
      ) ON COMMIT DROP;

      INSERT INTO advance_repayment_backfill_state (
        advance_id, employee_id, advance_date, recoverable_limit, already_recorded
      )
      SELECT
        a.id,
        a.employee_id,
        COALESCE(a.disbursed_at::date, a.date),
        GREATEST(0, a.amount - COALESCE(a.balance, 0)),
        COALESCE(SUM(r.amount), 0)
      FROM public.advances a
      LEFT JOIN public.advance_repayments r ON r.advance_id = a.id
      WHERE COALESCE(a.settlement_type, 'Payroll') <> 'Reconciliation'
        AND a.shortfall_action IS NULL
        AND COALESCE(a.status, 'Active') NOT IN ('Pending Approval', 'Rejected')
      GROUP BY a.id;

      FOR payroll_row IN
        SELECT employee_id, deduction_month, paid_on, advance_deduction
        FROM (
          SELECT
            pi.employee_id,
            date_trunc('month', COALESCE(
              p.paid_at::date,
              (make_date(p.year, p.month, 1) + INTERVAL '1 month - 1 day')::date
            ))::date AS deduction_month,
            COALESCE(p.paid_at::date, (make_date(p.year, p.month, 1) + INTERVAL '1 month - 1 day')::date) AS paid_on,
            pi.advance_deduction,
            ROW_NUMBER() OVER (
              PARTITION BY pi.employee_id, p.year, p.month
              ORDER BY COALESCE(p.paid_at, p.created_at) DESC, pi.created_at DESC, pi.id DESC
            ) AS payroll_row_number
          FROM public.payroll_items pi
          JOIN public.payrolls p ON p.id = pi.payroll_id
          WHERE LOWER(COALESCE(p.status, '')) = 'paid'
            AND COALESCE(pi.advance_deduction, 0) > 0
        ) paid_payrolls
        WHERE payroll_row_number = 1
        ORDER BY deduction_month, employee_id
      LOOP
        IF EXISTS (
          SELECT 1
          FROM public.advance_repayments r
          JOIN public.advances a ON a.id = r.advance_id
          WHERE a.employee_id = payroll_row.employee_id
            AND r.repayment_month = payroll_row.deduction_month
        ) THEN
          CONTINUE;
        END IF;

        SELECT s.*
        INTO target_advance
        FROM advance_repayment_backfill_state s
        WHERE s.employee_id = payroll_row.employee_id
          AND s.advance_date <= payroll_row.paid_on
          AND s.recoverable_limit > s.already_recorded
        ORDER BY s.advance_date, s.advance_id
        LIMIT 1;

        IF NOT FOUND THEN
          CONTINUE;
        END IF;

        remaining_recoverable := target_advance.recoverable_limit - target_advance.already_recorded;
        amount_to_record := LEAST(payroll_row.advance_deduction, remaining_recoverable);

        IF amount_to_record > 0 THEN
          INSERT INTO public.advance_repayments (
            advance_id, repayment_month, amount, notes
          )
          VALUES (
            target_advance.advance_id,
            payroll_row.deduction_month,
            amount_to_record,
            'Seeded from paid payroll deduction; assigned to oldest advance only; month reflects payment date'
          )
          ON CONFLICT (advance_id, repayment_month) DO NOTHING;

          UPDATE advance_repayment_backfill_state
          SET already_recorded = already_recorded + amount_to_record
          WHERE advance_id = target_advance.advance_id;
        END IF;
      END LOOP;

      DROP TABLE advance_repayment_backfill_state;
    END IF;

    INSERT INTO public.advance_repayments (advance_id, repayment_month, amount, is_legacy, notes)
    SELECT
      a.id,
      NULL,
      ROUND((
        GREATEST(0, a.amount - COALESCE(a.balance, 0))
        - COALESCE(SUM(r.amount), 0)
      )::numeric, 2),
      TRUE,
      'Historical repayments not attributable to a payroll month; preserved from the previous balance'
    FROM public.advances a
    LEFT JOIN public.advance_repayments r ON r.advance_id = a.id
    WHERE COALESCE(a.settlement_type, 'Payroll') <> 'Reconciliation'
      AND a.shortfall_action IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.advance_repayments payroll_repayment
        WHERE payroll_repayment.advance_id = a.id
          AND payroll_repayment.notes LIKE 'Seeded from paid payroll deduction; assigned to oldest advance only%'
      )
    GROUP BY a.id
    HAVING GREATEST(0, a.amount - COALESCE(a.balance, 0)) > COALESCE(SUM(r.amount), 0);

    UPDATE public.advances a
    SET balance = GREATEST(
      0,
      a.amount - COALESCE((
        SELECT SUM(r.amount)
        FROM public.advance_repayments r
        WHERE r.advance_id = a.id
      ), 0)
    ),
    status = CASE
      WHEN a.status = 'Closed'
        AND a.closed_at IS NULL
        AND a.shortfall_action IS NULL
        AND COALESCE((
          SELECT SUM(r.amount)
          FROM public.advance_repayments r
          WHERE r.advance_id = a.id
        ), 0) < a.amount
      THEN 'Active'
      ELSE a.status
    END
    WHERE COALESCE(a.settlement_type, 'Payroll') <> 'Reconciliation'
      AND a.shortfall_action IS NULL;
  END IF;
END
$$;
