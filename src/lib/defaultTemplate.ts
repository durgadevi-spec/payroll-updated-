import { PayslipTemplateContent } from '../types/payslip';

export const DEFAULT_PAYSLIP_TEMPLATE: PayslipTemplateContent = {
  header: {
    title: 'CONCEPT TRUNK INTERIORS',
    address: '12/36 Indira Gandhi Street, Perumbakkam Main Rd, Chennai, TN - 600100',
    showLogo: true,
    logoText: 'CT',
  },
  sections: {
    employeeDetails: {
      enabled: true,
      fields: [
        { label: 'Employee Code', key: 'employee_code' },
        { label: 'Employee Name', key: 'employee_name' },
        { label: 'Designation', key: 'designation' },
        { label: 'Department', key: 'department' },
        { label: 'Site / Location', key: 'site' },
        { label: 'Date of Joining', key: 'joining_date' },
        { label: 'PAN', key: 'pan' },
        { label: 'Bank (A/C)', key: 'bank_account' },
        { label: 'Mode of Pay', key: 'pay_mode' },
        { label: 'Payable Days', key: 'working_days' },
      ],
    },
    earnings: {
      title: 'EARNINGS',
      rows: [
        { label: 'Basic Salary', key: 'basic_salary' },
        { label: 'Sunday Work Earnings', key: 'sunday_work_earnings' },
        { label: 'HRA', key: 'hra' },
        { label: 'Conveyance Allowance', key: 'conveyance' },
        { label: 'Medical Allowance', key: 'medical' },
        { label: 'Special Allowance', key: 'bonus' },
      ],
    },
    deductions: {
      title: 'DEDUCTIONS',
      rows: [
        { label: 'LOP', key: 'leave_deduction' },
        { label: 'PF (12%)', key: 'pf_deduction' },
        { label: 'ESI (0.75%)', key: 'esi_deduction' },
        { label: 'Income Tax', key: 'tax_deduction' },
        { label: 'Loan Deduction', key: 'loan_deduction' },
        { label: 'Advance Deduction', key: 'advance_deduction' },
        { label: 'Total Deductions', key: 'total_deductions', isTotal: true },
      ],
    },
    summary: {
      title: 'Net Pay (Gross - Deductions)',
      showNetPayInWords: true,
    },
    footer: {
      remarks: [
        'This is a computer generated payslip and does not require a physical signature.',
        'For hygienic purposes and contactless handling, retain the digital copy.',
        'Verify bank account details before initiating transfers.',
        'Keep this payslip for your personal records and statutory compliance.',
      ],
      showGeneratedDate: true,
    },
  },
};

export const DEFAULT_PAYSLIP = {
  id: 'preview-id',
  employee_id: 'EMP12345',
  employee_name: 'John Doe',
  month: 8,
  year: 2026,
  net_salary: 47863,
  email_sent: false,
  employee: {
    id: 'EMP12345',
    name: 'John Doe',
    designation: 'Senior Designer',
    department: 'Creative',
    bank_account: 'XXXXXXXXXXXX1234'
  },
  payroll: {
    month: 8,
    year: 2026
  },
  payroll_item: {
    id: 'item-id',
    employee_id: 'EMP12345',
    working_days: 26,
    basic_salary: 45000,
    bonus: 5000,
    leave_deduction: 0,
    pf_deduction: 1800,
    esi_deduction: 337,
    tax_deduction: 0,
    advance_deduction: 0,
    loan_deduction: 0,
    net_salary: 47863
  }
};
