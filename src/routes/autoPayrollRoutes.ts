import { Router } from 'express';
import {
  getAutoPayrollStatus, saveAutoPayrollConfig, runAutoPayrollCheck, ensureAutoPayrollTable,
} from '../services/autoPayroll';

const router = Router();

router.get('/auto-payroll/settings', async (_req, res) => {
  try {
    await ensureAutoPayrollTable();
    res.json(await getAutoPayrollStatus());
  } catch (err: any) {
    console.error('[AUTO-PAYROLL] settings fetch failed:', err);
    res.status(500).json({ error: 'Failed to load auto payroll settings' });
  }
});

router.post('/auto-payroll/settings', async (req, res) => {
  const { enabled, day, user_email } = req.body || {};
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
  try {
    await saveAutoPayrollConfig({ enabled, day: Number(day) }, user_email);
    res.json(await getAutoPayrollStatus());
  } catch (err: any) {
    const msg = err?.message || 'Failed to save auto payroll settings';
    res.status(/Day must/.test(msg) ? 400 : 500).json({ error: msg });
  }
});

// Optional "run the check now" — honours the duplicate guard; used for catch-up/testing.
router.post('/auto-payroll/run-now', async (_req, res) => {
  try {
    res.json(await runAutoPayrollCheck({ force: true }));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Auto payroll run failed' });
  }
});

export { router as autoPayrollRouter };