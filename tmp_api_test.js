import http from 'http';

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/payroll-items/analysis/1',
  method: 'GET',
  headers: {
    'Accept': 'application/json'
  }
};

const req = http.request(options, (res) => {
  console.log('STATUS', res.statusCode);
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('BODY', body);
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.error('ERROR', err.message);
  process.exit(1);
});
req.end();
