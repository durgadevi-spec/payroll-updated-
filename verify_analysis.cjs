const http = require('http');
const PAYROLL_ID = 'c67f5bde-99dd-428d-827a-7305945b63c6';

http.get('http://localhost:5001/api/payroll-items/analysis/' + PAYROLL_ID, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) {
        console.log('Error:', data.substring(0, 300));
        return;
      }

      console.log('=== FULL PAYROLL ANALYSIS (May 2026) ===\n');
      parsed.forEach(item => {
        const leaves = (item.leave_dates || []);
        const missing = (item.missing_dates || []);
        const excluded = (item.timesheet_excluded_dates || []);
        
        console.log(`${item.employee_name} (${item.employee_code || 'no-code'})`);
        console.log(`  Approved Leave Dates (${leaves.length}): ${leaves.join(', ') || 'none'}`);
        console.log(`  Raw Missing TS Dates (${missing.length + excluded.length}): ${[...excluded, ...missing].join(', ') || 'none'}`);
        console.log(`  Excluded by Leave (${excluded.length}): ${excluded.join(', ') || 'none'}`);
        console.log(`  Final Missing TS Days: ${item.missing_timesheets}`);
        console.log(`  TS Deduction: ${item.timesheet_deduction}`);
        console.log(`  Leave Deduction: ${item.leave_deduction}`);
        console.log(`  Net Salary: ${item.net_salary}`);
        console.log('');
      });

      console.log('=== SUMMARY ===');
      console.log('Total employees:', parsed.length);
      const issues = parsed.filter(item => {
        const leaves = new Set(item.leave_dates || []);
        const missing = item.missing_dates || [];
        return missing.some(d => leaves.has(d));
      });
      if (issues.length > 0) {
        console.log('WARN: These employees still have leave/TS overlap not excluded:', issues.map(i => i.employee_name));
      } else {
        console.log('OK: No leave/TS overlap issues found!');
      }
    } catch (e) {
      console.log('Parse error:', e.message);
      console.log(data.substring(0, 200));
    }
  });
});
