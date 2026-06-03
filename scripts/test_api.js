const fetch = require('node-fetch');

async function run() {
  try {
    const res = await fetch('http://localhost:5002/api/payroll-items/external-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeIds: ['0e95ff90-c0d1-4470-87df-505697669d67'], // Rebecasuji id (I will query for it if needed)
        month: 5, // let's try 5 (May) or 6 (June)
        year: 2026
      })
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(err);
  }
}
run();
