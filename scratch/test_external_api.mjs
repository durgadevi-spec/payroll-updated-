const API_URL = 'http://localhost:5002/api/payroll-items/external-data';

async function main() {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeIds: ['69360141-a6ca-43c7-9cc2-ad9365d75ac6'], // Rebecasuji
        month: 3,
        year: 2026
      })
    });
    const data = await res.json();
    console.log('Response structure:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}
main();
