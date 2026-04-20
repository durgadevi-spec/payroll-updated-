import express from 'express';
import cors from 'cors';
import { payrollRouter } from './src/routes/payrollRoutes.ts';
import { emailRouter } from './src/routes/emailRoutes.ts';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 5002;

app.use(cors());
app.use(express.json());

// Request logger for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

app.get('/', (req, res) => {
  res.send('Payroll API server is running.');
});

app.use('/api', payrollRouter);
app.use('/api', emailRouter);

app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found', 
    path: req.url,
    method: req.method,
    message: 'Valid routes start with /api' 
  });
});

app.listen(PORT, () => {
  console.log(`Payroll API server listening on http://localhost:${PORT}`);
});