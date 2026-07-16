export type CalculationType = 'monthly' | 'custom' | 'working_days';

export interface PayrollCalculationInput {
  monthlySalary: number;
  workingDays: number;       // Working days (used as fallback if calendarDays not provided)
  calendarDays?: number;     // Actual calendar days in the month (30/31) — used for per-day rate
  unpaidLeaves: number;
  missingTimesheets: number;
  missingPunches?: number;
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
  permissionHours?: number;
  sundayDeductions?: number;
  hourlyDeductionAmount?: number; // Pre-calculated deduction for daily biometric hours short of 9h (not covered by LMS permission / monthly 3h allowance)
}

export interface PayrollCalculationResult {
  monthlySalary: number;
  leaveDeduction: number;
  timesheetDeduction: number;
  missingPunchDeduction: number;
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
  permissionHours: number;
  permissionDeduction: number;
  sundayDeductionAmount: number;
  hourlyDeductionAmount: number;
}

export function calculatePayroll(input: PayrollCalculationInput): PayrollCalculationResult {
  const {
    monthlySalary,
    workingDays: settingsWorkingDays,
    calendarDays,
    unpaidLeaves,
    missingTimesheets,
    missingPunches = 0,
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
    permissionHours = 0,
    sundayDeductions = 0,
    hourlyDeductionAmount = 0,
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
  const missingPunchDeduction = Math.round(perDaySalary * missingPunches * 100) / 100;
  const sundayWorkEarnings = Math.round(perDaySalary * sundayWorkDays * 100) / 100;

  // Permission deduction logic: first 3 hours are free. Deduct for remaining hours.
  let permissionDeduction = 0;
  if (permissionHours > 3) {
    const excessHours = permissionHours - 3;
    const perHourSalary = perDaySalary / 8; // Assuming 8 working hours per day
    permissionDeduction = Math.round(excessHours * perHourSalary * 100) / 100;
  }

  const sundayDeductionAmount = Math.round(perDaySalary * sundayDeductions * 100) / 100;

  const salaryAfterAttendance = baseSalary - leaveDeduction - timesheetDeduction - missingPunchDeduction - permissionDeduction - sundayDeductionAmount - hourlyDeductionAmount + sundayWorkEarnings;

  const pfDeduction = Math.round((salaryAfterAttendance * pfRate) / 100 * 100) / 100;
  const esiDeduction =
    monthlySalary <= esiLimit
      ? Math.round((salaryAfterAttendance * esiRate) / 100 * 100) / 100
      : 0;

  const grossEarnings = salaryAfterAttendance + bonus;
  const taxableAmount = grossEarnings - pfDeduction - esiDeduction;
  const taxDeduction = Math.round((taxableAmount * taxRate) / 100 * 100) / 100;

  const totalDeductions =
    leaveDeduction + timesheetDeduction + missingPunchDeduction + permissionDeduction + hourlyDeductionAmount + pfDeduction + esiDeduction + taxDeduction + loanDeduction + advanceDeduction;

  const netSalary = Math.max(0, baseSalary - totalDeductions + bonus + sundayWorkEarnings);

  return {
    monthlySalary,
    leaveDeduction,
    timesheetDeduction,
    missingPunchDeduction,
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
    permissionHours,
    permissionDeduction,
    sundayDeductionAmount,
    hourlyDeductionAmount
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