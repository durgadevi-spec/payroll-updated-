-- Fix RLS for email_groups and email_group_members to allow anonymous access (Development Mode)

-- Drop existing authenticated policies
DROP POLICY IF EXISTS "Authenticated users can view email_groups" ON email_groups;
DROP POLICY IF EXISTS "Authenticated users can insert email_groups" ON email_groups;
DROP POLICY IF EXISTS "Authenticated users can update email_groups" ON email_groups;
DROP POLICY IF EXISTS "Authenticated users can delete email_groups" ON email_groups;

DROP POLICY IF EXISTS "Authenticated users can view email_group_members" ON email_group_members;
DROP POLICY IF EXISTS "Authenticated users can insert email_group_members" ON email_group_members;
DROP POLICY IF EXISTS "Authenticated users can delete email_group_members" ON email_group_members;

-- Create anonymous policies for email_groups
CREATE POLICY "Anonymous users can view email_groups"
  ON email_groups FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous users can insert email_groups"
  ON email_groups FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous users can update email_groups"
  ON email_groups FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anonymous users can delete email_groups"
  ON email_groups FOR DELETE
  TO anon
  USING (true);

-- Create anonymous policies for email_group_members
CREATE POLICY "Anonymous users can view email_group_members"
  ON email_group_members FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous users can insert email_group_members"
  ON email_group_members FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous users can delete email_group_members"
  ON email_group_members FOR DELETE
  TO anon
  USING (true);
