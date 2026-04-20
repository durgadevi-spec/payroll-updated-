-- Email Groups Table
CREATE TABLE IF NOT EXISTS email_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE email_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view email_groups"
  ON email_groups FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert email_groups"
  ON email_groups FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update email_groups"
  ON email_groups FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete email_groups"
  ON email_groups FOR DELETE
  TO authenticated
  USING (true);

-- Email Group Members Table
CREATE TABLE IF NOT EXISTS email_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES email_groups(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(group_id, employee_id)
);

ALTER TABLE email_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view email_group_members"
  ON email_group_members FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert email_group_members"
  ON email_group_members FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete email_group_members"
  ON email_group_members FOR DELETE
  TO authenticated
  USING (true);
