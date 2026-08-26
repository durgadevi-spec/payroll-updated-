import { Router, Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { payrollPool } from './payrollRoutes.ts';
import * as dotenv from 'dotenv';
dotenv.config({ path: './.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export const selfServiceRouter = Router();

export interface AuthenticatedRequest extends Request {
  employee?: any;
  role?: string;
  user?: any;
}

export const requireEmployeeAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase is not configured on the backend.' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user || !user.email) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.user = user;

  let client;
  try {
    client = await payrollPool.connect();
    
    let result = await client.query('SELECT * FROM employees WHERE auth_user_id = $1', [user.id]);
    
    if (result.rows.length === 0) {
      result = await client.query('SELECT * FROM employees WHERE LOWER(email) = LOWER($1)', [user.email]);
      
      if (result.rows.length > 0) {
        const empId = result.rows[0].id;
        const updateRes = await client.query(
          'UPDATE employees SET auth_user_id = $1 WHERE id = $2 RETURNING *',
          [user.id, empId]
        );
        result = updateRes;
      } else {
        return res.status(403).json({ error: 'No employee record found for this account' });
      }
    }

    const employee = result.rows[0];
    const normalizedRole = String(employee.role || 'employee').trim().toLowerCase();
    req.employee = employee;
    req.role = normalizedRole === 'admin' ? 'admin' : 'employee';
    next();
  } catch (err) {
    console.error('Error in requireEmployeeAuth:', err);
    res.status(500).json({ error: 'Internal server error resolving identity' });
  } finally {
    if (client) client.release();
  }
};

selfServiceRouter.use(requireEmployeeAuth);

selfServiceRouter.get('/me', (req: AuthenticatedRequest, res: Response) => {
  res.json({
    role: req.role,
    employee: req.employee,
  });
});

selfServiceRouter.get('/me/advances', async (req: AuthenticatedRequest, res: Response) => {
  const employeeId = req.employee.id;
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query(`
      SELECT a.*, e.name as employee_name, e.email as employee_email
      FROM advances a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.employee_id = $1
      ORDER BY a.created_at DESC
    `, [employeeId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching my advances:', err);
    res.status(500).json({ error: 'Failed to fetch advances' });
  } finally {
    if (client) client.release();
  }
});

selfServiceRouter.post('/me/advances/request', async (req: AuthenticatedRequest, res: Response) => {
  const employeeId = req.employee.id;
  const {
    amount,
    date,
    advance_type = 'Salary Advance',
    reason = '',
    repayment_type = 'Monthly',
    no_of_installments = '1',
    remarks = ''
  } = req.body;

  if (!amount || isNaN(Number(amount))) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  let client;
  try {
    client = await payrollPool.connect();
    
    const result = await client.query(`
      INSERT INTO advances (
        employee_id, amount, date, advance_type, reason, 
        repayment_type, no_of_installments, remarks,
        status, balance, installment_amount, request_source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending Approval', $2, 0, 'Employee Request')
      RETURNING *
    `, [
      employeeId, amount, date || new Date().toISOString().split('T')[0],
      advance_type, reason, repayment_type, no_of_installments, remarks
    ]);

    await client.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ($1,$2,$3,$4,$5)`,
      ['REQUEST_ADVANCE', 'advances', result.rows[0].id, JSON.stringify({ amount, advance_type }), req.user?.email || 'unknown']
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error raising advance request:', err);
    res.status(500).json({ error: 'Failed to raise advance request' });
  } finally {
    if (client) client.release();
  }
});

selfServiceRouter.get('/me/payslips', async (req: AuthenticatedRequest, res: Response) => {
  const employeeId = req.employee.id;
  let client;
  try {
    client = await payrollPool.connect();
    const result = await client.query(`
      SELECT ps.*, 
             e.id as emp_id, e.name as emp_name, e.email as emp_email, e.designation, e.department, e.bank_account, e.pf_number, e.uan_number,
             p.id as pr_id, p.month, p.year, p.status as pr_status,
             pi.monthly_salary, pi.leave_deduction, pi.timesheet_deduction, pi.pf_deduction, pi.esi_deduction, pi.tax_deduction, pi.loan_deduction, pi.advance_deduction, pi.sunday_work_days, pi.bonus, pi.net_salary, pi.working_days, pi.unpaid_leaves
      FROM payslips ps
      JOIN employees e ON ps.employee_id = e.id
      JOIN payrolls p ON ps.payroll_id = p.id
      JOIN payroll_items pi ON pi.payroll_id = p.id AND pi.employee_id = e.id
      WHERE ps.employee_id = $1
      ORDER BY ps.created_at DESC
    `, [employeeId]);
    
    const mapped = result.rows.map(r => ({
      id: r.id,
      payroll_id: r.payroll_id,
      employee_id: r.employee_id,
      status: r.status,
      email_sent: r.email_sent,
      email_sent_at: r.email_sent_at,
      created_at: r.created_at,
      employee: { id: r.emp_id, name: r.emp_name, email: r.emp_email, designation: r.designation, department: r.department, bank_account: r.bank_account, pf_number: r.pf_number, uan_number: r.uan_number },
      payroll: { id: r.pr_id, month: r.month, year: r.year, status: r.pr_status },
      payroll_item: {
        monthly_salary: r.monthly_salary, leave_deduction: r.leave_deduction, timesheet_deduction: r.timesheet_deduction,
        pf_deduction: r.pf_deduction, esi_deduction: r.esi_deduction, tax_deduction: r.tax_deduction, loan_deduction: r.loan_deduction,
        advance_deduction: r.advance_deduction, sunday_work_days: r.sunday_work_days, bonus: r.bonus, net_salary: r.net_salary,
        working_days: r.working_days, unpaid_leaves: r.unpaid_leaves
      }
    }));

    res.json(mapped);
  } catch (err) {
    console.error('Error fetching my payslips:', err);
    res.status(500).json({ error: 'Failed to fetch payslips' });
  } finally {
    if (client) client.release();
  }
});

selfServiceRouter.get('/me/attendance', async (req: AuthenticatedRequest, res: Response) => {
  const employeeCode = req.employee.employee_code;
  const { month, year } = req.query;

  let client;
  try {
    client = await payrollPool.connect();
    
    let queryArgs: any[] = [employeeCode];
    let dateFilter = '';
    
    if (month && year) {
      dateFilter = 'AND EXTRACT(MONTH FROM punch_time) = $2 AND EXTRACT(YEAR FROM punch_time) = $3';
      queryArgs.push(Number(month), Number(year));
    }
    
    const logsRes = await client.query(`
      SELECT emp_code, punch_time 
      FROM attendance_logs 
      WHERE emp_code = $1 ${dateFilter}
      ORDER BY punch_time DESC
      LIMIT 1000
    `, queryArgs);

    res.json(logsRes.rows);
  } catch (err) {
    console.error('Error fetching my attendance:', err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  } finally {
    if (client) client.release();
  }
});
