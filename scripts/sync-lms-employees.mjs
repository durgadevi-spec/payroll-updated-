import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const lmsUrl = process.env.LMS_DATABASE_URL;
const payrollUrl = process.env.PAYROLL_DATABASE_URL;

if (!lmsUrl || !payrollUrl) {
  console.error('LMS_DATABASE_URL and PAYROLL_DATABASE_URL are required');
  process.exit(1);
}

async function sync() {
  const lmsClient = new Client({ connectionString: lmsUrl, ssl: { rejectUnauthorized: false } });
  const payrollClient = new Client({ connectionString: payrollUrl, ssl: { rejectUnauthorized: false } });

  try {
    await lmsClient.connect();
    await payrollClient.connect();

    console.log('Fetching employees from LMS...');
    const lmsRes = await lmsClient.query('SELECT * FROM employees');
    console.log(`Found ${lmsRes.rows.length} employees in LMS`);

    let inserted = 0;
    let updated = 0;

    for (const emp of lmsRes.rows) {
      // Use employee_code as email if email is missing, or construct a fake one
      // The payroll system seems to use employee_code in the email field for synced records
      const email = emp.employee_code.toLowerCase(); 
      
      const upsertQuery = `
        INSERT INTO employees (
          id, name, email, designation, joining_date, status, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 'active', NOW())
        ON CONFLICT (email) DO UPDATE SET
          id = EXCLUDED.id,
          name = EXCLUDED.name,
          designation = EXCLUDED.designation,
          joining_date = EXCLUDED.joining_date,
          updated_at = NOW()
        RETURNING *
      `;

      try {
        const res = await payrollClient.query(upsertQuery, [
          emp.id,
          emp.name,
          email,
          emp.designation || '',
          emp.join_date || null
        ]);
        
        if (res.rowCount > 0) {
          // Check if it was an insert or update by comparing created_at if available, 
          // but for now just count success
          updated++; 
        }
      } catch (err) {
        console.error(`Failed to sync employee ${emp.name}:`, err.message);
      }
    }

    console.log(`Sync completed. Processed ${lmsRes.rows.length} employees.`);
    console.log(`Total synced/updated: ${updated}`);

  } catch (err) {
    console.error('Sync failed:', err);
  } finally {
    await lmsClient.end();
    await payrollClient.end();
  }
}

sync();
