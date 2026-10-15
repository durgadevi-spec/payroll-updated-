export interface SalaryBreakdown {
  basic_salary: number;
  hra: number;
  conveyance: number;
  medical: number;
  special_allowance: number;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function getSalaryBreakdown(grossSalary: number): SalaryBreakdown {
  const gross = Math.max(0, Number(grossSalary) || 0);
  const basic_salary = round2(gross * 0.50);
  const hra = round2(gross * 0.20);
  const conveyance = round2(gross * 0.08);
  const medical = round2(gross * 0.04);
  const special_allowance = round2(gross - basic_salary - hra - conveyance - medical);

  return { basic_salary, hra, conveyance, medical, special_allowance };
}
