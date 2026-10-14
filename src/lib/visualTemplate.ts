/**
 * Shared logic for "Image Template" payslips (an uploaded payslip image with
 * fields, text boxes and cover boxes placed on top).
 * Used by the designer, the on-screen payslip and the server-side PDF so all
 * three always show the same values. Keep this file free of browser/DOM-only
 * imports at module level (the server imports it too).
 */
import type { VisualField } from '../types/payslip';
import { numberToWords } from './numberToWords';
import { getSalaryBreakdown } from './salaryBreakdown';

export const PAGE_WIDTH_PX = 800; // virtual page width everything is measured against
export const A4_ASPECT = 297 / 210;

export interface VisualFieldOption {
    key: string;
    label: string;
    group: 'Employee' | 'Earnings' | 'Deductions' | 'Totals';
    money?: boolean;
}

export const VISUAL_FIELD_OPTIONS: VisualFieldOption[] = [
    { key: 'employee_name', label: 'Employee Name', group: 'Employee' },
    { key: 'employee_code', label: 'Employee Code', group: 'Employee' },
    { key: 'designation', label: 'Designation', group: 'Employee' },
    { key: 'department', label: 'Department', group: 'Employee' },
    { key: 'site_location', label: 'Site / Location', group: 'Employee' },
    { key: 'pan_number', label: 'PAN Number', group: 'Employee' },
    { key: 'bank_account', label: 'Bank A/C', group: 'Employee' },
    { key: 'month_year', label: 'Month & Year', group: 'Employee' },
    { key: 'working_days', label: 'Payable Days', group: 'Employee' },
    { key: 'calculation_days', label: 'Days Considered', group: 'Employee' },
    { key: 'basic_salary', label: 'Basic Salary', group: 'Earnings', money: true },
    { key: 'hra', label: 'HRA', group: 'Earnings', money: true },
    { key: 'conveyance', label: 'Conveyance Allowance', group: 'Earnings', money: true },
    { key: 'medical', label: 'Medical Allowance', group: 'Earnings', money: true },
    { key: 'special_allowance', label: 'Special Allowance', group: 'Earnings', money: true },
    { key: 'sunday_work_earnings', label: 'Sunday Work Earnings', group: 'Earnings', money: true },
    { key: 'bonus', label: 'Bonus', group: 'Earnings', money: true },
    { key: 'previous_month_balance', label: 'Previous Month Balance', group: 'Earnings', money: true },
    { key: 'total_earnings', label: 'Total Earnings', group: 'Earnings', money: true },
    { key: 'leave_deduction', label: 'LOP', group: 'Deductions', money: true },
    { key: 'pf_deduction', label: 'PF', group: 'Deductions', money: true },
    { key: 'esi_deduction', label: 'ESI', group: 'Deductions', money: true },
    { key: 'tax_deduction', label: 'Income Tax', group: 'Deductions', money: true },
    { key: 'loan_deduction', label: 'Loan Deduction', group: 'Deductions', money: true },
    { key: 'advance_deduction', label: 'Advance Deduction', group: 'Deductions', money: true },
    { key: 'total_deductions', label: 'Total Deductions', group: 'Deductions', money: true },
    { key: 'net_salary', label: 'Net Pay', group: 'Totals', money: true },
    { key: 'net_salary_words', label: 'Net Pay in Words', group: 'Totals' },
];

const MONEY_KEYS = new Set(VISUAL_FIELD_OPTIONS.filter(o => o.money).map(o => o.key));
export const isMoneyKey = (key?: string) => !!key && MONEY_KEYS.has(key);

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Everything a payslip needs, whichever side (browser / server) it comes from. */
export interface VisualPayslipData {
    employee_name?: string;
    employee_code?: string;
    designation?: string;
    department?: string;
    site_location?: string;
    pan_number?: string;
    bank_account?: string;
    month?: number;
    year?: number;
    working_days?: number;
    calculation_days?: number;
    monthly_salary?: number;
    basic_salary?: number;
    hra?: number;
    conveyance?: number;
    medical?: number;
    special_allowance?: number;
    sunday_work_days?: number;
    bonus?: number;
    previous_month_balance?: number;
    leave_deduction?: number;
    timesheet_deduction?: number;
    pf_deduction?: number;
    esi_deduction?: number;
    tax_deduction?: number;
    loan_deduction?: number;
    advance_deduction?: number;
    net_salary?: number;
}

const n = (v: unknown) => Number(v || 0);
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Raw value for a data key: a number for money keys, text otherwise. */
export function resolveVisualValue(key: string | undefined, d: VisualPayslipData): number | string {
    const salaryBreakdown = getSalaryBreakdown(d.monthly_salary ?? 0, {
        hra: d.hra,
        conveyance: d.conveyance,
        medical: d.medical,
    });
    const sundayEarnings = round2((n(d.monthly_salary) / (n(d.working_days) || 30)) * n(d.sunday_work_days));
    const lop = n(d.leave_deduction) + n(d.timesheet_deduction);
    const totalEarnings = n(d.monthly_salary) + sundayEarnings + n(d.bonus) + n(d.previous_month_balance);
    const totalDeductions = lop + n(d.pf_deduction) + n(d.esi_deduction) + n(d.tax_deduction) + n(d.loan_deduction) + n(d.advance_deduction);
    switch (key) {
        case 'employee_name': return d.employee_name || '';
        case 'employee_code': return d.employee_code || '';
        case 'designation': return d.designation || '';
        case 'department': return d.department || '';
        case 'site':
        case 'site_location': return d.site_location || '';
        case 'pan_number': return d.pan_number || '';
        case 'bank_account': return d.bank_account || '';
        case 'month_year': return d.month ? `${LONG_MONTHS[d.month - 1]} ${d.year ?? ''}`.trim() : '';
        case 'working_days': return String(n(d.working_days));
        case 'calculation_days': return String(d.calculation_days ?? d.working_days ?? 0);
        case 'monthly_salary':
            return n(d.monthly_salary);
        case 'basic_salary': return d.basic_salary ?? salaryBreakdown.basic_salary;
        case 'hra': return salaryBreakdown.hra;
        case 'conveyance': return salaryBreakdown.conveyance;
        case 'medical': return salaryBreakdown.medical;
        case 'special_allowance': return salaryBreakdown.special_allowance;
        case 'sunday_work_earnings': return sundayEarnings;
        case 'bonus': return n(d.bonus);
        case 'previous_month_balance': return n(d.previous_month_balance);
        case 'total_earnings': return round2(totalEarnings);
        case 'leave_deduction': return lop;
        case 'pf_deduction': return n(d.pf_deduction);
        case 'esi_deduction': return n(d.esi_deduction);
        case 'tax_deduction': return n(d.tax_deduction);
        case 'loan_deduction': return n(d.loan_deduction);
        case 'advance_deduction': return n(d.advance_deduction);
        case 'total_deductions': return round2(totalDeductions);
        case 'net_salary': return n(d.net_salary);
        case 'net_salary_words': return `${numberToWords(Math.round(n(d.net_salary)))} Only`;
        default: return '';
    }
}

/**
 * Final text for one placed item.
 * `symbol` is the rupee prefix: '₹' on screen, 'Rs. ' in PDFs (the built-in PDF font has no ₹ glyph).
 */
export function visualItemText(field: VisualField, d: VisualPayslipData, symbol = '₹'): string {
    const kind = field.kind || 'field';
    if (kind === 'cover') return '';
    if (kind === 'text') return field.text ?? '';
    const v = resolveVisualValue(field.key, d);
    if (typeof v === 'number') {
        const num = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
        return field.showSymbol ? `${symbol}${num}` : num;
    }
    return v;
}

export function defaultItem(kind: 'field' | 'text' | 'cover', key?: string, name?: string): VisualField {
    const id = Math.random().toString(36).slice(2, 11);
    if (kind === 'cover') {
        return { id, kind, name: 'Cover box', x: 40, y: 40, width: 18, height: 3, fontSize: 12, fontWeight: 'normal', color: '#000000', bgColor: '#ffffff' };
    }
    if (kind === 'text') {
        return { id, kind, name: 'Text', text: 'Your text', x: 40, y: 40, width: 22, height: 3, fontSize: 12, fontWeight: 'normal', color: '#000000', align: 'left', bgColor: '' };
    }
    const money = isMoneyKey(key);
    return {
        id, kind, key, name: name || key || 'Field', x: 40, y: 40, width: money ? 14 : 22, height: 3,
        fontSize: 12, fontWeight: 'normal', color: '#000000', align: money ? 'right' : 'left', bgColor: '', showSymbol: false,
    };
}

/** Load an image and read the median colour of some pixels (used by "match paper colour"). */
export async function sampleImageColor(src: string, points: { x: number; y: number }[]): Promise<string> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Could not read the template image'));
        i.src = src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    ctx.drawImage(img, 0, 0);
    const rs: number[] = [], gs: number[] = [], bs: number[] = [];
    for (const p of points) {
        const px = Math.min(canvas.width - 1, Math.max(0, Math.round((p.x / 100) * canvas.width)));
        const py = Math.min(canvas.height - 1, Math.max(0, Math.round((p.y / 100) * canvas.height)));
        const data = ctx.getImageData(px, py, 1, 1).data;
        rs.push(data[0]); gs.push(data[1]); bs.push(data[2]);
    }
    if (!rs.length) return '#ffffff';
    // median per channel so a stray table border line doesn't tint the result
    const med = (a: number[]) => { const t = [...a].sort((x, y) => x - y); return t[Math.floor(t.length / 2)]; };
    const hex = (v: number) => v.toString(16).padStart(2, '0');
    return `#${hex(med(rs))}${hex(med(gs))}${hex(med(bs))}`;
}