ALTER TABLE payrolls
  ADD COLUMN IF NOT EXISTS balance_adjustment_mode text;

CREATE TABLE IF NOT EXISTS payroll_paid_amounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_id uuid NOT NULL REFERENCES payrolls(id) ON DELETE RESTRICT,
  payroll_item_id uuid NOT NULL UNIQUE REFERENCES payroll_items(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  advance_repayment_amount numeric(12,2),
  paid_at timestamptz NOT NULL DEFAULT now(),
  paid_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_paid_amounts_payroll_id_idx
  ON payroll_paid_amounts(payroll_id);
CREATE INDEX IF NOT EXISTS payroll_paid_amounts_employee_id_idx
  ON payroll_paid_amounts(employee_id);

ALTER TABLE payroll_paid_amounts
  ADD COLUMN IF NOT EXISTS advance_repayment_amount numeric(12,2);

ALTER TABLE payroll_paid_amounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view payroll paid amounts" ON payroll_paid_amounts;
CREATE POLICY "Authenticated users can view payroll paid amounts"
  ON payroll_paid_amounts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert payroll paid amounts" ON payroll_paid_amounts;
CREATE POLICY "Authenticated users can insert payroll paid amounts"
  ON payroll_paid_amounts FOR INSERT TO authenticated WITH CHECK (true);

CREATE TABLE IF NOT EXISTS payroll_balance_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_id uuid NOT NULL REFERENCES payrolls(id) ON DELETE CASCADE,
  payroll_item_id uuid NOT NULL UNIQUE REFERENCES payroll_items(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  previous_paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  previous_paid_advance_repayment numeric(12,2),
  previous_paid_payroll_id uuid,
  previous_paid_version integer,
  recalculated_net_salary numeric(12,2) NOT NULL DEFAULT 0,
  balance_payable numeric(12,2) NOT NULL DEFAULT 0,
  overpayment_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payroll_balance_adjustments
  ADD COLUMN IF NOT EXISTS previous_paid_payroll_id uuid;
ALTER TABLE payroll_balance_adjustments
  ADD COLUMN IF NOT EXISTS previous_paid_version integer;
ALTER TABLE payroll_balance_adjustments
  ADD COLUMN IF NOT EXISTS previous_paid_advance_repayment numeric(12,2);

CREATE INDEX IF NOT EXISTS payroll_balance_adjustments_payroll_id_idx
  ON payroll_balance_adjustments(payroll_id);

ALTER TABLE payroll_balance_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view payroll balance adjustments" ON payroll_balance_adjustments;
CREATE POLICY "Authenticated users can view payroll balance adjustments"
  ON payroll_balance_adjustments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert payroll balance adjustments" ON payroll_balance_adjustments;
CREATE POLICY "Authenticated users can insert payroll balance adjustments"
  ON payroll_balance_adjustments FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update payroll balance adjustments" ON payroll_balance_adjustments;
CREATE POLICY "Authenticated users can update payroll balance adjustments"
  ON payroll_balance_adjustments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION mark_payroll_as_paid(p_payroll_id uuid, p_paid_by text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated_payroll_id uuid;
  payment_timestamp timestamptz := now();
BEGIN
   SELECT id INTO updated_payroll_id
     FROM payrolls
    WHERE id = p_payroll_id AND status = 'completed'
    FOR UPDATE;

   IF updated_payroll_id IS NULL THEN
     RAISE EXCEPTION 'Payroll does not exist or is not in completed status';
   END IF;

   UPDATE payroll_balance_adjustments pba
      SET previous_paid_advance_repayment = COALESCE(pba.previous_paid_advance_repayment, prior.advance_deduction, 0),
          balance_payable = GREATEST(
            ROUND((pba.recalculated_net_salary - pba.previous_paid_amount - COALESCE(pba.previous_paid_advance_repayment, prior.advance_deduction, 0))::numeric, 2),
            0
          ),
          overpayment_amount = GREATEST(
            ROUND((pba.previous_paid_amount + COALESCE(pba.previous_paid_advance_repayment, prior.advance_deduction, 0) - pba.recalculated_net_salary)::numeric, 2),
            0
          )
     FROM payroll_items prior
    WHERE pba.payroll_id = p_payroll_id
      AND prior.payroll_id = pba.previous_paid_payroll_id
      AND prior.employee_id = pba.employee_id;

   UPDATE payroll_items current_item
      SET net_salary = pba.balance_payable
     FROM payroll_balance_adjustments pba
    WHERE pba.payroll_id = p_payroll_id
      AND pba.payroll_item_id = current_item.id;

   UPDATE payrolls
      SET status = 'paid',
          paid_at = payment_timestamp,
          total_amount = (
            SELECT COALESCE(SUM(net_salary), 0)
              FROM payroll_items
             WHERE payroll_id = p_payroll_id
          )
    WHERE id = p_payroll_id AND status = 'completed'
   RETURNING id INTO updated_payroll_id;

  IF updated_payroll_id IS NULL THEN
    RAISE EXCEPTION 'Payroll does not exist or is not in completed status';
  END IF;

  INSERT INTO payroll_paid_amounts (
    payroll_id, payroll_item_id, employee_id, paid_amount, advance_repayment_amount, paid_at, paid_by
  )
  SELECT
    p_payroll_id, id, employee_id, GREATEST(COALESCE(net_salary, 0), 0),
    GREATEST(COALESCE(advance_deduction, 0), 0), payment_timestamp, p_paid_by
  FROM payroll_items
  WHERE payroll_id = p_payroll_id;
END;
$$;

REVOKE ALL ON FUNCTION mark_payroll_as_paid(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_payroll_as_paid(uuid, text) TO authenticated;
