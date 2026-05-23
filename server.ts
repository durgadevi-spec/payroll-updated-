import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { payrollRouter } from './src/routes/payrollRoutes.ts';
import { emailRouter } from './src/routes/emailRoutes.ts';
import { startNightlyAlertScheduler, runNightlyAlerts } from './src/jobs/nightlyAlerts.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 5002;

app.use(cors());
app.use(express.json());

// Request logger for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});



app.use('/api', payrollRouter);
app.use('/api', emailRouter);

// Manual trigger for testing — POST /api/alerts/trigger
app.post('/api/alerts/trigger', async (req, res) => {
  try {
    const testDate = (req.body as any)?.date; // optional: pass { "date": "2026-04-27" } to test a specific date
    const result = await runNightlyAlerts(testDate);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Alert job failed' });
  }
});

// Serve React static files from the 'dist' directory
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// Catch-all route to serve React's index.html or return 404 for missing API routes
app.get('*', (req, res) => {
  if (req.url.startsWith('/api/')) {
    res.status(404).json({ 
      error: 'Route not found', 
      path: req.url,
      method: req.method,
      message: 'Valid routes start with /api' 
    });
  } else {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`Payroll API server listening on http://localhost:${PORT}`);
  startNightlyAlertScheduler();
});