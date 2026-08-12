ALTER TABLE employees ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS role varchar(20) DEFAULT 'employee';
