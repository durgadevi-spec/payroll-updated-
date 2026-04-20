import { Client } from 'pg';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const lmsUrl = process.env.LMS_DATABASE_URL;
const payrollUrl = process.env.PAYROLL_DATABASE_URL;

async function sync() {
  const lmsClient = new Client({ connectionString: lmsUrl, ssl: { rejectUnauthorized: false } });
  const payrollClient = new Client({ connectionString: payrollUrl, ssl: { rejectUnauthorized: false } });

  try {
    await lmsClient.connect();
    await payrollClient.connect();

    console.log('Fetching all users and employees from LMS...');
    const usersRes = await lmsClient.query('SELECT user_id, username, email, role FROM users');
    const employeesRes = await lmsClient.query('SELECT id, employee_code, name, designation, join_date FROM employees');
    
    console.log(`LMS Data: ${usersRes.rows.length} users, ${employeesRes.rows.length} employee profiles`);

    // We will build a map of unique people to sync
    // Using employee_code/user_id as the primary key for matching
    const syncMap = new Map();

    // 1. First, populate from employees table (it has UUIDs)
    for (const emp of employeesRes.rows) {
      if (!emp.employee_code) continue;
      const code = emp.employee_code.toLowerCase();
      syncMap.set(code, {
        id: emp.id,
        name: emp.name,
        email: code, // Fallback to code as email key
        designation: emp.designation || '',
        join_date: emp.join_date || null
      });
    }

    // 2. Then, add/update from users table (ensure everyone is included)
    for (const user of usersRes.rows) {
      if (!user.user_id) continue;
      const code = user.user_id.toLowerCase();
      const existing = syncMap.get(code);

      if (existing) {
        // Update name/email if they were missing or generic
        if (user.username && (!existing.name || existing.name === 'Unknown')) {
          existing.name = user.username;
        }
        // If the user has a real email, we can use it, but currently the system 
        // uses the employee_code as the unique email key for syncing logic.
        // We'll stick to 'code' as email to prevent duplicates and keep sync simple.
      } else {
        // Add new user not found in employees table
        syncMap.set(code, {
          id: null, // Generate new UUID in DB
          name: user.username || 'Unknown',
          email: code,
          designation: user.role || '',
          join_date: null
        });
      }
    }

    console.log(`Ready to sync ${syncMap.size} unique records to Payroll DB...`);

    let count = 0;
    for (const [code, data] of syncMap) {
      const cleanName = data.name.replace(/\n/g, ' ').trim();
      
      const query = data.id 
        ? `INSERT INTO employees (id, name, email, designation, joining_date, status, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'active', NOW())
           ON CONFLICT (email) DO UPDATE SET 
             id = EXCLUDED.id,
             name = EXCLUDED.name,
             designation = EXCLUDED.designation,
             updated_at = NOW()
           RETURNING *`
        : `INSERT INTO employees (name, email, designation, joining_date, status, updated_at)
           VALUES ($1, $2, $3, $4, 'active', NOW())
           ON CONFLICT (email) DO UPDATE SET 
             name = EXCLUDED.name,
             designation = EXCLUDED.designation,
             updated_at = NOW()
           RETURNING *`;

      const params = data.id 
        ? [data.id, cleanName, data.email, data.designation, data.join_date]
        : [cleanName, data.email, data.designation, data.join_date];

      try {
        await payrollClient.query(query, params);
        count++;
      } catch (err) {
        console.error(`Error syncing ${cleanName} (${code}):`, err.message);
      }
    }

    console.log(`Sync completed successfully. ${count} employees are now in the Payroll system.`);

  } catch (err) {
    console.error('Sync failed:', err);
  } finally {
    await lmsClient.end();
    await payrollClient.end();
  }
}

sync();
