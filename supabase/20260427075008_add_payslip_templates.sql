CREATE TABLE IF NOT EXISTS payslip_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    is_default BOOLEAN DEFAULT false,
    content JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE payslip_templates ENABLE ROW LEVEL SECURITY;

-- Allow anonymous access for development (matching existing pattern)
CREATE POLICY "Public users can view payslip_templates"
  ON payslip_templates FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Public users can insert payslip_templates"
  ON payslip_templates FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Public users can update payslip_templates"
  ON payslip_templates FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Public users can delete payslip_templates"
  ON payslip_templates FOR DELETE
  TO public
  USING (true);


-- Add template_id to payslips table
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES payslip_templates(id) ON DELETE SET NULL;