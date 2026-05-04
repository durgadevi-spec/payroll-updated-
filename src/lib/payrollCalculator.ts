export type CalculationType = 'monthly' | 'custom' | 'working_days';

export interface PayrollCalculationInput {
  monthlySalary: number;
  workingDays: number;       // Working days (used as fallback if calendarDays not provided)
  calendarDays?: number;     // Actual calendar days in the month (30/31) — used for per-day rate
  unpaidLeaves: number;
  missingTimesheets: number;
  bonus: number;
  pfRate: number;
  esiRate: number;
  esiLimit: number;
  taxRate: number;
  loanDeduction: number;
  advanceDeduction?: number;
  sundayWorkDays?: number;
  calculationType?: CalculationType;
  customDays?: number;
}

export interface PayrollCalculationResult {
  monthlySalary: number;
  leaveDeduction: number;
  timesheetDeduction: number;
  pfDeduction: number;
  esiDeduction: number;
  taxDeduction: number;
  loanDeduction: number;
  advanceDeduction: number;
  sundayWorkEarnings: number;
  bonus: number;
  grossEarnings: number;
  totalDeductions: number;
  netSalary: number;
}

export function calculatePayroll(input: PayrollCalculationInput): PayrollCalculationResult {
  const {
    monthlySalary,
    workingDays: settingsWorkingDays,
    calendarDays,
    unpaidLeaves,
    missingTimesheets,
    bonus,
    pfRate,
    esiRate,
    esiLimit,
    taxRate,
    loanDeduction,
    advanceDeduction = 0,
    sundayWorkDays = 0,
    calculationType = 'monthly',
    customDays = 0,
  } = input;

  // Determination of days for per-day rate calculation
  let daysForRate = calendarDays ?? settingsWorkingDays;
  let daysToCalculateFor = daysForRate; // Default to full period

  if (calculationType === 'custom' && customDays > 0) {
    // Salary calculated for specific number of days
    daysToCalculateFor = customDays;
  } else if (calculationType === 'working_days') {
    // Salary calculated based on working days (excluding Sundays)
    daysForRate = settingsWorkingDays;
    daysToCalculateFor = settingsWorkingDays;
  }

  const perDaySalary = monthlySalary / daysForRate;
  const baseSalary = perDaySalary * daysToCalculateFor;

  const leaveDeduction = Math.round(perDaySalary * unpaidLeaves * 100) / 100;
  const timesheetDeduction = Math.round(perDaySalary * missingTimesheets * 100) / 100;
  const sundayWorkEarnings = Math.round(perDaySalary * sundayWorkDays * 100) / 100;

  const salaryAfterAttendance = baseSalary - leaveDeduction - timesheetDeduction + sundayWorkEarnings;

  const pfDeduction = Math.round((salaryAfterAttendance * pfRate) / 100 * 100) / 100;
  const esiDeduction =
    monthlySalary <= esiLimit
      ? Math.round((salaryAfterAttendance * esiRate) / 100 * 100) / 100
      : 0;

  const grossEarnings = salaryAfterAttendance + bonus;
  const taxableAmount = grossEarnings - pfDeduction - esiDeduction;
  const taxDeduction = Math.round((taxableAmount * taxRate) / 100 * 100) / 100;

  const totalDeductions =
    leaveDeduction + timesheetDeduction + pfDeduction + esiDeduction + taxDeduction + loanDeduction + advanceDeduction;

  const netSalary = Math.max(0, baseSalary - totalDeductions + bonus + sundayWorkEarnings);

  return {
    monthlySalary,
    leaveDeduction,
    timesheetDeduction,
    pfDeduction,
    esiDeduction,
    taxDeduction,
    loanDeduction,
    advanceDeduction,
    sundayWorkEarnings,
    bonus,
    grossEarnings,
    totalDeductions,
    netSalary: Math.round(netSalary * 100) / 100,
  };
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getMonthName(month: number): string {
  return new Date(2000, month - 1, 1).toLocaleString('default', { month: 'long' });
}

export function getCurrentMonth(): { month: number; year: number } {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}
