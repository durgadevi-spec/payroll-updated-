-- LMS Integration Schema
-- This schema supports leave and permission records for the LMS database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS lms_leaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  year integer NOT NULL,
  total_leaves integer DEFAULT 0,
  paid_leaves integer DEFAULT 0,
  unpaid_leaves integer DEFAULT 0,
  leave_type text DEFAULT 'general',
  approved boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, month, year)
);

CREATE TABLE IF NOT EXISTS permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  permission_type text NOT NULL,
  status text DEFAULT 'pending',
  granted_by text DEFAULT '',
  start_date date,
  end_date date,
  remarks text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
