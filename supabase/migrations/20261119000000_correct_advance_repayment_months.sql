BEGIN;

DO $$
BEGIN
  IF to_regclass('public.advance_repayments') IS NOT NULL
     AND to_regclass('public.advances') IS NOT NULL
     AND to_regclass('public.payroll_items') IS NOT NULL
     AND to_regclass('public.payrolls') IS NOT NULL THEN
    CREATE TEMP TABLE advance_repayment_month_corrections ON COMMIT DROP AS
    WITH paid_payrolls AS (
      SELECT
        pi.employee_id,
        make_date(p.year, p.month, 1) AS payroll_month,
        date_trunc('month', COALESCE(
          p.paid_at::date,
          (make_date(p.year, p.month, 1) + INTERVAL '1 month - 1 day')::date
        ))::date AS payment_month,
        ROW_NUMBER() OVER (
          PARTITION BY pi.employee_id, p.year, p.month
          ORDER BY COALESCE(p.paid_at, p.created_at) DESC, pi.created_at DESC, pi.id DESC
        ) AS payroll_row_number
      FROM public.payroll_items pi
      JOIN public.payrolls p ON p.id = pi.payroll_id
      WHERE LOWER(COALESCE(p.status, '')) = 'paid'
        AND COALESCE(pi.advance_deduction, 0) > 0
    )
    SELECT
      r.id,
      r.advance_id,
      r.amount,
      payroll.payment_month
    FROM public.advance_repayments r
    JOIN public.advances a ON a.id = r.advance_id
    JOIN paid_payrolls payroll
      ON payroll.employee_id = a.employee_id
     AND payroll.payroll_month = r.repayment_month
     AND payroll.payroll_row_number = 1
    WHERE r.notes = 'Seeded from paid payroll deduction; assigned to oldest advance only';

    CREATE TEMP TABLE advance_repayment_month_groups ON COMMIT DROP AS
    SELECT
      correction.advance_id,
      correction.payment_month,
      (ARRAY_AGG(correction.id ORDER BY correction.id))[1] AS imported_keeper_id,
      SUM(correction.amount) AS imported_amount,
      existing.id AS existing_id,
      COALESCE(existing.amount, 0) AS existing_amount
    FROM advance_repayment_month_corrections correction
    LEFT JOIN LATERAL (
      SELECT repayment.id, repayment.amount
      FROM public.advance_repayments repayment
      WHERE repayment.advance_id = correction.advance_id
        AND repayment.repayment_month = correction.payment_month
        AND NOT EXISTS (
          SELECT 1
          FROM advance_repayment_month_corrections mapped
          WHERE mapped.id = repayment.id
        )
      LIMIT 1
    ) existing ON TRUE
    GROUP BY correction.advance_id, correction.payment_month, existing.id, existing.amount;

    UPDATE public.advance_repayments repayment
    SET repayment_month = NULL
    FROM advance_repayment_month_corrections correction
    WHERE repayment.id = correction.id;

    DELETE FROM public.advance_repayments repayment
    USING advance_repayment_month_corrections correction,
          advance_repayment_month_groups grouped
    WHERE repayment.id = correction.id
      AND correction.advance_id = grouped.advance_id
      AND correction.payment_month = grouped.payment_month
      AND repayment.id <> COALESCE(grouped.existing_id, grouped.imported_keeper_id);

    UPDATE public.advance_repayments repayment
    SET repayment_month = grouped.payment_month,
        amount = grouped.imported_amount + grouped.existing_amount,
        notes = CASE
          WHEN grouped.existing_id IS NULL
            THEN 'Seeded from paid payroll deduction; assigned to oldest advance only; month corrected to payment date'
          ELSE CONCAT_WS('; ', NULLIF(repayment.notes, ''), 'Includes imported payroll repayments')
        END,
        updated_at = NOW()
    FROM advance_repayment_month_groups grouped
    WHERE repayment.id = COALESCE(grouped.existing_id, grouped.imported_keeper_id);
  END IF;
END
$$;

COMMIT;
