import { calculatePayroll } from './src/lib/payrollCalculator.ts';

const res = calculatePayroll({
  monthlySalary: 25000,
  workingDays: 26,
  calendarDays: 31,
  unpaidLeaves: 3,
  missingTimesheets: 0,
  bonus: 0,
  pfRate: 12,
  esiRate: 0.75,
  esiLimit: 21000,
  taxRate: 10,
  loanDeduction: 0,
  advanceDeduction: 0,
  sundayWorkDays: 0,
  calculationType: 'monthly',
});

console.log(JSON.stringify(res, null, 2));
