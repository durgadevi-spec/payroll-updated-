BEGIN;

DELETE FROM public.advance_repayments legacy
WHERE legacy.is_legacy
  AND legacy.notes = 'Historical repayments not attributable to a payroll month; preserved from the previous balance'
  AND EXISTS (
    SELECT 1
    FROM public.advance_repayments payroll_repayment
    WHERE payroll_repayment.advance_id = legacy.advance_id
      AND payroll_repayment.notes LIKE 'Seeded from paid payroll deduction; assigned to oldest advance only%'
  );

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

COMMIT;
