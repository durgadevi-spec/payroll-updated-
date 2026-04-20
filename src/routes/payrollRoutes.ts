import { Router } from 'express';
import { Pool, Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const payrollUrl = process.env.PAYROLL_DATABASE_URL as string;
const lmsUrl = process.env.LMS_DATABASE_URL;
const timesheetUrl = process.env.TIMESTRAP_DATABASE_URL || process.env.TIMESHEET_DATABASE_URL || process.env.DATABASE_URL;
if (!payrollUrl) {
  throw new Error('PAYROLL_DATABASE_URL is required for payroll routes.');
}

function normalizeConnectionString(connectionString: string) {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return connectionString.replace(/([?&])sslmode=(require|prefer|verify-ca)(&|$)/gi, (match, sep, mode, tail) => {
      if (sep === '?') {
        return tail ? '?' : '';
      }
      return tail ? sep : '';
    });
  }
}

function createPool(connectionString: string) {
  const normalizedConnectionString = normalizeConnectionString(connectionString);
  return new Pool({
    connectionString: normalizedConnectionString,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

function createClient(connectionString: string) {
  const normalizedConnectionString = normalizeConnectionString(connectionString);
  return new Client({
    connectionString: normalizedConnectionString,
    ssl: { rejectUnauthorized: false },
  });
}

const payrollPool = createPool(payrollUrl);
const lmsPool = lmsUrl ? createPool(lmsUrl) : null;
const timesheetPool = timesheetUrl ? createPool(timesheetUrl) : null;

function createPayrollClient() {
  return createClient(payrollUrl);
}

function createLmsClient() {
  return lmsUrl ? createClient(lmsUrl) : null;
}

function createTimesheetClient() {
  return timesheetUrl ? createClient(timesheetUrl) : null;
}

const router = Router();

router.get('/employees', async (_req, res) => {
  let client;
  try {
    client = await payrollPool.connect();
    console.log('Fetching employees from payroll DB...');
    const result = await client.query('SELECT * FROM employees ORDER BY created_at DESC');
    console.log(`Found ${result.rows.length} employees`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.json([]);
  } finally {
    if (client) client.release();
  }
});

router.post('/employees', async (req, res) => {
  const {
    name,
    email,
    salary,
    department = '',
    designation = '',
    joining_date = null,
    bank_name = '',
    bank_account = '',
    ifsc_code = '',
    pf_number = '',
    esi_number = '',
    uan_number = '',
    status = 'active',
  } = req.body;

  let client;
  try {
    client = await payrollPool.connect();
    const insert = await client.query(
      `INSERT INTO employees (name, email, salary, department, designation, joining_date, bank_name, bank_account, ifsc_code, pf_number, esi_number, uan_number, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [name, email, salary, department, designation, joining_date, bank_name, bank_account, ifsc_code, pf_number, esi_number, uan_number, status]
    );

    const employee = insert.rows[0];
    await client.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ($1,$2,$3,$4,$5)`,
      ['CREATE_EMPLOYEE', 'employees', employee.id, JSON.stringify({ name, email }), 'admin@company.com']
    );

    res.status(201).json(employee);
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(500).json({ error: 'Failed to create employee' });
  } finally {
    if (client) client.release();
  }
});

router.put('/employees/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name,
    email,
    salary,
    department = '',
    designation = '',
    joining_date = null,
    bank_name = '',
    bank_account = '',
    ifsc_code = '',
    pf_number = '',
    esi_number = '',
    uan_number = '',
    status = 'active',
  } = req.body;

  let client;
  try {
    client = await payrollPool.connect();
    const update = await client.query(
      `UPDATE employees SET name=$1, email=$2, salary=$3, department=$4, designation=$5, joining_date=$6, bank_name=$7, bank_account=$8, ifsc_code=$9, pf_number=$10, esi_number=$11, uan_number=$12, status=$13, updated_at=NOW()
       WHERE id=$14 RETURNING *`,
      [name, email, salary, department, designation, joining_date, bank_name, bank_account, ifsc_code, pf_number, esi_number, uan_number, status, id]
    );

    const employee = update.rows[0];
    await client.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ($1,$2,$3,$4,$5)`,
      ['UPDATE_EMPLOYEE', 'employees', id, JSON.stringify({ name, email }), 'admin@company.com']
    );

    res.json(employee);
  } catch (error) {
    console.error('Error updating employee:', error);
    res.status(500).json({ error: 'Failed to update employee' });
  } finally {
    if (client) client.release();
  }
});

router.delete('/employees/:id', async (_req, res) => {
  const { id } = _req.params;
  let client;
  try {
    client = await payrollPool.connect();
    const employeeResult = await client.query('SELECT * FROM employees WHERE id=$1', [id]);
    const employee = employeeResult.rows[0];
    await client.query('DELETE FROM employees WHERE id=$1', [id]);
    await client.query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_email) VALUES ($1,$2,$3,$4,$5)`,
      ['DELETE_EMPLOYEE', 'employees', id, JSON.stringify({ name: employee?.name, email: employee?.email }), 'admin@company.com']
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ error: 'Failed to delete employee' });
  } finally {
    if (client) client.release();
  }
});

router.post('/employees/sync-timesheet', async (_req, res) => {
  let timesheetClient, payrollClient;
  try {
    timesheetClient = await timesheetPool?.connect();
    payrollClient = await payrollPool.connect();
    
    const result = await timesheetClient!.query('SELECT * FROM employees');

    const inserted = [];
    const updated = [];

    for (const row of result.rows) {
      const {
        id,
        name,
        email,
        salary,
        department,
        designation,
        joining_date,
        bank_name,
        bank_account,
        ifsc_code,
        pf_number,
        esi_number,
        uan_number,
        status,
      } = row;

      if (!email) continue;

      const upsert = await payrollClient.query(
        `INSERT INTO employees (id, name, email, salary, department, designation, joining_date, bank_name, bank_account, ifsc_code, pf_number, esi_number, uan_number, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           salary = EXCLUDED.salary,
           department = EXCLUDED.department,
           designation = EXCLUDED.designation,
           joining_date = EXCLUDED.joining_date,
           bank_name = EXCLUDED.bank_name,
           bank_account = EXCLUDED.bank_account,
           ifsc_code = EXCLUDED.ifsc_code,
           pf_number = EXCLUDED.pf_number,
           esi_number = EXCLUDED.esi_number,
           uan_number = EXCLUDED.uan_number,
           status = EXCLUDED.status,
           updated_at = NOW()
         RETURNING *`,
        [id, name || '', email, salary || 0, department || '', designation || '', joining_date || null, bank_name || '', bank_account || '', ifsc_code || '', pf_number || '', esi_number || '', uan_number || '', status || 'active']
      );

      const employee = upsert.rows[0];
      if (employee.email === email && employee.name === name) {
        inserted.push(employee);
      } else {
        updated.push(employee);
      }
    }

    res.json({ inserted: inserted.length, updated: updated.length, total: result.rowCount });
  } catch (error) {
    console.error('Error syncing employees from timesheet DB:', error);
    res.status(500).json({ error: 'Failed to sync employees' });
  } finally {
    if (timesheetClient) timesheetClient.release();
    if (payrollClient) payrollClient.release();
  }
});

router.post('/payroll-items/external-data', async (req, res) => {
  const { employeeIds, month, year } = req.body;
  
  const leaveMap: Record<string, { employee_id: string; unpaid_leaves: number; total_leaves: number; paid_leaves: number; leave_type: string }> = {};
  const timesheetMap: Record<string, { employee_id: string; missing_days: number; submitted_at: string | null }> = {};

  let pClient, lmsClient, timesheetClient;

  try {
    pClient = await payrollPool.connect();
    const namesRes = await pClient.query('SELECT id, name, email FROM employees WHERE id = ANY($1)', [employeeIds]);
    const empData = namesRes.rows;
    const settingsResult = await pClient.query('SELECT value FROM settings WHERE key = \'working_days\'');
    const workingDays = parseInt(settingsResult.rows[0]?.value || '26');
    pClient.release();

    if (lmsPool) {
      lmsClient = await lmsPool.connect();
      for (const emp of empData) {
        try {
          const leaveQuery = `
            SELECT 
              SUM(CASE 
                WHEN l.leave_duration_type = 'Half Day' THEN 0.5 
                ELSE 1.0 
              END) as unpaid_leaves,
              SUM(CASE 
                WHEN l.leave_duration_type = 'Half Day' THEN 0.5 
                ELSE 1.0 
              END) as total_leaves,
              0 as paid_leaves,
              MAX(l.leave_type) as leave_type
            FROM employees e
            JOIN leaves l ON e.employee_code = l.user_id
            WHERE l.status = 'Approved'
              AND (
                (EXTRACT(MONTH FROM l.start_date) = $2 AND EXTRACT(YEAR FROM l.start_date) = $3)
                OR (EXTRACT(MONTH FROM l.end_date) = $2 AND EXTRACT(YEAR FROM l.end_date) = $3)
              )
              AND (
                e.id = $1 
                OR LOWER(TRIM(e.name)) = LOWER(TRIM($4))
                OR (e.name ILIKE $4 || '%')
                OR ($4 ILIKE e.name || '%')
                OR LOWER(TRIM(e.employee_code)) = LOWER(TRIM($5))
              )
            GROUP BY e.id
          `;
          console.log(`[EXTERNAL-DATA] Fetching leaves for ${emp.name} (${emp.id})`);
          const leaveRes = await lmsClient.query(leaveQuery, [emp.id, month, year, emp.name, emp.email]);
          
          if (leaveRes.rows.length > 0) {
            const row = leaveRes.rows[0];
            const unpaid = parseFloat(String(row.unpaid_leaves || 0));
            console.log(`[EXTERNAL-DATA] ✅ Found ${unpaid} leaves for ${emp.name}`);
            leaveMap[emp.id] = { 
              ...row, 
              employee_id: emp.id,
              unpaid_leaves: unpaid,
              total_leaves: parseFloat(String(row.total_leaves || 0))
            };
          } else {
            console.log(`[EXTERNAL-DATA] ❌ No leaves found for ${emp.name}`);
          }
        } catch (error) {
          console.error('Unable to fetch leaves for employee:', emp.name, error);
        }
      }
    }

    if (timesheetPool) {
      console.log(`[EXTERNAL-DATA] Querying timesheet for Month: ${month}, Year: ${year}`);
      timesheetClient = await timesheetPool.connect();
      
      const codes = empData.map((e: any) => {
        const code = e.name.includes('REBECA') ? 'E0046' : (e.email || '').toUpperCase();
        return code;
      });
      console.log(`[EXTERNAL-DATA] Searching for codes: ${JSON.stringify(codes)}`);

      const tsRes = await timesheetClient.query(
        `SELECT employee_code, count(DISTINCT CAST(date as date)) as days_worked 
         FROM time_entries 
         WHERE UPPER(employee_code) = ANY($1) AND EXTRACT(MONTH FROM CAST(date as date)) = $2 AND EXTRACT(YEAR FROM CAST(date as date)) = $3
         GROUP BY employee_code`,
        [codes, month, year]
      );
      
      console.log(`[EXTERNAL-DATA] Found ${tsRes.rows.length} matches from timesheet DB`);
      
      for (const row of tsRes.rows) {
        console.log(`[EXTERNAL-DATA] Row from DB: ${row.employee_code}, Days Worked: ${row.days_worked}`);
        const emp = empData.find((e: any) => {
          const matchCode = e.name.includes('REBECA') ? 'E0046' : (e.email || '').toUpperCase();
          return matchCode === row.employee_code.toUpperCase();
        });
        
        if (emp) {
          console.log(`[EXTERNAL-DATA] ✅ MATCHED code ${row.employee_code} to employee ${emp.name} (${emp.id})`);
          timesheetMap[emp.id] = { 
            employee_id: emp.id, 
            missing_days: Math.max(0, workingDays - parseInt(row.days_worked)), 
            submitted_at: new Date().toISOString() 
          };
        } else {
          console.log(`[EXTERNAL-DATA] ❌ Could not find employee for code ${row.employee_code} in fetched empData`);
        }
      }
    } else {
      console.warn('[EXTERNAL-DATA] Timesheet database URL not configured. Skipping external timesheet lookup.');
    }

    res.json({ leaves: Object.values(leaveMap), timesheets: Object.values(timesheetMap) });
  } catch (error) {
    console.error('Error fetching external payroll data:', error);
    res.status(500).json({ error: 'Failed to fetch external payroll data' });
  } finally {
    if (lmsClient) lmsClient.release();
    if (timesheetClient) timesheetClient.release();
  }
});

router.get('/payroll-items/analysis/:payrollId', async (req, res) => {
  const { payrollId } = req.params;
  
  let payrollClient, lmsClient, timesheetClient;
  
  try {
    payrollClient = await payrollPool.connect();
    lmsClient = lmsPool ? await lmsPool.connect() : null;
    timesheetClient = timesheetPool ? await timesheetPool.connect() : null;

    const payrollResult = await payrollClient.query('SELECT month, year FROM payrolls WHERE id=$1', [payrollId]);
    const payroll = payrollResult.rows[0];
    if (!payroll) {
      return res.status(404).json({ error: 'Payroll not found' });
    }

    const settingsResult = await payrollClient.query('SELECT value FROM settings WHERE key = \'working_days\'');
    const workingDays = parseInt(settingsResult.rows[0]?.value || '26');

    const itemsResult = await payrollClient.query(
      `SELECT pi.*, e.id AS employee_id, e.name AS employee_name, e.email AS employee_email, e.designation AS employee_designation, e.department AS employee_department, e.bank_account AS employee_bank_account, e.pf_number AS employee_pf_number, e.uan_number AS employee_uan_number
       FROM payroll_items pi
       JOIN employees e ON e.id = pi.employee_id
       WHERE pi.payroll_id = $1`,
      [payrollId]
    );

    console.log(`Analyzing payroll ${payrollId}: Found ${itemsResult.rows.length} items`);

    interface PayrollItemAnalysisRow {
      employee_id: string;
      employee_name: string;
      employee_email: string;
      employee_designation: string;
      employee_department: string;
      employee_bank_account: string;
      employee_pf_number: string;
      employee_uan_number: string;
      unpaid_leaves: number;
      missing_timesheets: number;
      [key: string]: unknown;
    }

    const enriched = [];
    for (const item of itemsResult.rows as PayrollItemAnalysisRow[]) {
      let leaveData: { unpaid_leaves?: number; leave_type?: string } | null = null;
      let tsData: { missing_days?: number; submitted_at?: string } | null = null;

      if (lmsClient) {
        try {
          const leaveQuery = `
            SELECT 
              SUM(CASE 
                WHEN l.leave_duration_type = 'Half Day' THEN 0.5 
                ELSE 1.0 
              END) as unpaid_leaves,
              SUM(CASE 
                WHEN l.leave_duration_type = 'Half Day' THEN 0.5 
                ELSE 1.0 
              END) as total_leaves,
              0 as paid_leaves,
              MAX(l.leave_type) as leave_type
            FROM employees e
            JOIN leaves l ON e.employee_code = l.user_id
            WHERE l.status = 'Approved'
              AND (
                (EXTRACT(MONTH FROM l.start_date) = $2 AND EXTRACT(YEAR FROM l.start_date) = $3)
                OR (EXTRACT(MONTH FROM l.end_date) = $2 AND EXTRACT(YEAR FROM l.end_date) = $3)
              )
              AND (
                e.id = $1 
                OR LOWER(TRIM(e.name)) = LOWER(TRIM($4))
                OR (e.name ILIKE $4 || '%')
                OR ($4 ILIKE e.name || '%')
                OR LOWER(TRIM(e.employee_code)) = LOWER(TRIM($5))
              )
            GROUP BY e.id
          `;
          const leaveRes = await lmsClient.query(leaveQuery, [item.employee_id, payroll.month, payroll.year, item.employee_name, item.employee_email]);
          if (leaveRes.rows.length > 0) {
            console.log(`LMS Match for ${item.employee_name} in analysis: ${leaveRes.rows[0].unpaid_leaves} days`);
            leaveData = {
              ...leaveRes.rows[0],
              unpaid_leaves: parseFloat(String(leaveRes.rows[0].unpaid_leaves || 0)),
              total_leaves: parseFloat(String(leaveRes.rows[0].total_leaves || 0))
            };
          }
        } catch (error) {
          console.error('LMS query failed for employee', item.employee_id, error);
        }
      }

      if (timesheetClient) {
        try {
          const empCode = item.employee_name.includes('REBECA') ? 'E0046' : item.employee_email;
          console.log(`[ANALYSIS] Fetching TS for ${item.employee_name} using code ${empCode} for ${payroll.month}/${payroll.year}`);
          const tsRes = await timesheetClient.query(
            `SELECT count(DISTINCT CAST(date as date)) as days_worked 
             FROM time_entries 
             WHERE UPPER(employee_code) = UPPER($1) AND EXTRACT(MONTH FROM CAST(date as date)) = $2 AND EXTRACT(YEAR FROM CAST(date as date)) = $3`,
            [empCode, payroll.month, payroll.year]
          );
          if (tsRes.rows.length > 0 && tsRes.rows[0].days_worked > 0) {
            const worked = parseInt(tsRes.rows[0].days_worked);
            console.log(`[ANALYSIS] ✅ Found ${worked} days for ${item.employee_name}`);
            tsData = { 
              missing_days: Math.max(0, workingDays - worked), 
              submitted_at: new Date().toISOString() 
            };
          } else {
            console.log(`[ANALYSIS] ❌ No days found for ${item.employee_name} with code ${empCode}`);
          }
        } catch (error) {
          console.error('[ANALYSIS] Timesheet query failed for employee', item.employee_id, error);
        }
      }

      enriched.push({
        ...item,
        employee: {
          id: item.employee_id,
          name: item.employee_name,
          email: item.employee_email,
          designation: item.employee_designation,
          department: item.employee_department,
          bank_account: item.employee_bank_account,
          pf_number: item.employee_pf_number,
          uan_number: item.employee_uan_number,
        },
        unpaid_leaves: leaveData?.unpaid_leaves ?? item.unpaid_leaves,
        leave_source: leaveData ? `LMS (${leaveData.leave_type})` : 'No LMS leave record',
        missing_timesheets: tsData?.missing_days ?? item.missing_timesheets,
        timesheet_status: tsData ? 'Submitted' : 'Not submitted',
        timesheet_submitted_at: tsData?.submitted_at || null,
      });
    }

    console.log(`Sending enriched analysis for ${enriched.length} items...`);
    res.json(enriched);
  } catch (error) {
    console.error('Error fetching payroll item analysis:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch payroll analysis' });
  } finally {
    if (payrollClient) payrollClient.release();
    if (lmsClient) lmsClient.release();
    if (timesheetClient) timesheetClient.release();
  }
});

router.patch('/payroll-items/:id', async (req, res) => {
  const { id } = req.params;
  const { advance_deduction, sunday_work_days, bonus } = req.body;
  
  let client;
  try {
    client = await payrollPool.connect();
    
    const currentRes = await client.query('SELECT * FROM payroll_items WHERE id = $1', [id]);
    const item = currentRes.rows[0];
    if (!item) return res.status(404).json({ error: 'Item not found' });
    
    const newAdvance = advance_deduction !== undefined ? parseFloat(advance_deduction) : parseFloat(item.advance_deduction || 0);
    const newSundayWork = sunday_work_days !== undefined ? parseFloat(sunday_work_days) : parseFloat(item.sunday_work_days || 0);
    const newBonus = bonus !== undefined ? parseFloat(bonus) : parseFloat(item.bonus || 0);
    
    const basicSalary = parseFloat(item.basic_salary);
    const workingDays = parseInt(item.working_days || 26);
    const dayRate = basicSalary / workingDays;
    
    const leaveDeduction = parseFloat(item.leave_deduction);
    const tsDeduction = parseFloat(item.timesheet_deduction);
    const pfDeduction = parseFloat(item.pf_deduction);
    const esiDeduction = parseFloat(item.esi_deduction);
    const taxDeduction = parseFloat(item.tax_deduction);
    const loanDeduction = parseFloat(item.loan_deduction);
    
    const sundayEarnings = Math.round(dayRate * newSundayWork * 100) / 100;
    
    const totalDeductions = leaveDeduction + tsDeduction + pfDeduction + esiDeduction + taxDeduction + loanDeduction + newAdvance;
    const netSalary = Math.max(0, Math.round((basicSalary - totalDeductions + newBonus + sundayEarnings) * 100) / 100);
    
    const updateRes = await client.query(
      `UPDATE payroll_items SET 
        advance_deduction = $1, 
        sunday_work_days = $2, 
        bonus = $3, 
        net_salary = $4
       WHERE id = $5 RETURNING *`,
      [newAdvance, newSundayWork, newBonus, netSalary, id]
    );
    
    res.json(updateRes.rows[0]);
  } catch (err) {
    console.error('Error updating payroll item:', err);
    res.status(500).json({ error: 'Failed to update item' });
  } finally {
    if (client) client.release();
  }
});

export { router as payrollRouter };