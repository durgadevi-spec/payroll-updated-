export interface SalaryBreakdown {
  basic_salary: number;
  hra: number;
  conveyance: number;
  medical: number;
  special_allowance: number;
}

export interface SalaryBreakdownOverrides {
  hra?: number | null;
  conveyance?: number | null;
  medical?: number | null;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function getSalaryBreakdown(
  grossSalary: number,
  overrides: SalaryBreakdownOverrides = {},
): SalaryBreakdown {
  const gross = Math.max(0, Number(grossSalary) || 0);
  const basic_salary = round2(gross * 8500 / 16935);
  const hra = Number(overrides.hra) > 0
    ? round2(Number(overrides.hra))
    : round2(gross * 2654 / 16935);
  const conveyance = Number(overrides.conveyance) > 0
    ? round2(Number(overrides.conveyance))
    : round2(gross * 2000 / 16935);
  const medical = Number(overrides.medical) > 0
    ? round2(Number(overrides.medical))
    : round2(gross * 1935 / 16935);
  const special_allowance = round2(gross - basic_salary - hra - conveyance - medical);

  return { basic_salary, hra, conveyance, medical, special_allowance };
}
