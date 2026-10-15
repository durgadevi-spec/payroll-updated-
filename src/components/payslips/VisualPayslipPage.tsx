import { CSSProperties, ReactNode } from 'react';
import { PayslipFull } from '../../types';
import { VisualField, PayslipTemplateContent } from '../../types/payslip';
import { A4_ASPECT, PAGE_WIDTH_PX, VisualPayslipData, visualItemText } from '../../lib/visualTemplate';

type VisualConfig = NonNullable<PayslipTemplateContent['visualConfig']>;

const WEIGHTS: Record<string, number> = { normal: 400, medium: 500, bold: 700, black: 900 };

/** CSS box for one placed item. Shared by the designer and the real payslip so they match exactly. */
export function visualItemStyle(f: VisualField): CSSProperties {
    const align = f.align || 'left';
    return {
        position: 'absolute',
        left: `${f.x}%`,
        top: `${f.y}%`,
        width: f.width != null ? `${f.width}%` : undefined,
        height: f.height != null ? `${f.height}%` : undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
        padding: '0 2px',
        boxSizing: 'border-box',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        lineHeight: 1.1,
        fontFamily: 'Helvetica, Arial, sans-serif',
        fontSize: `${f.fontSize}px`,
        fontWeight: WEIGHTS[f.fontWeight] ?? 400,
        color: f.color,
        backgroundColor: f.bgColor || 'transparent',
    };
}

export function pageHeightPx(config: Pick<VisualConfig, 'aspectRatio'>) {
    return Math.round(PAGE_WIDTH_PX * (config.aspectRatio || A4_ASPECT));
}

/** Map the app's PayslipFull object to the flat shape the shared value resolver wants. */
export function payslipToVisualData(payslip: PayslipFull): VisualPayslipData {
    const item: any = payslip.payroll_item || {};
    const emp: any = payslip.employee || {};
    return {
        employee_name: emp.name,
        employee_code: emp.employee_code || emp.id,
        designation: emp.designation,
        department: emp.department,
        site_location: emp.site_location,
        pan_number: emp.pan_number,
        bank_account: emp.bank_account,
        month: payslip.payroll?.month,
        year: payslip.payroll?.year,
        working_days: item.working_days,
        calculation_days: item.calculation_days,
        monthly_salary: item.monthly_salary,
        hra: item.hra,
        conveyance: item.conveyance,
        medical: item.medical,
        sunday_work_days: item.sunday_work_days,
        bonus: item.bonus,
        previous_month_balance: item.previous_month_balance,
        leave_deduction: item.leave_deduction,
        timesheet_deduction: item.timesheet_deduction,
        missing_punch_deduction: item.missing_punch_deduction,
        pf_deduction: item.pf_deduction,
        esi_deduction: item.esi_deduction,
        tax_deduction: item.tax_deduction,
        loan_deduction: item.loan_deduction,
        advance_deduction: item.advance_deduction,
        net_salary: item.net_salary,
    };
}

interface Props {
    config: VisualConfig;
    data: VisualPayslipData;
    children?: ReactNode;
}

/** A finished (read-only) image-template payslip: the image, then covers/text/values on top. */
export function VisualPayslipPage({ config, data, children }: Props) {
    return (
        <div
            className="relative bg-white shadow-2xl overflow-hidden"
            style={{
                width: `${PAGE_WIDTH_PX}px`,
                height: `${pageHeightPx(config)}px`,
                backgroundImage: `url(${config.backgroundImage})`,
                backgroundSize: '100% 100%',
                backgroundRepeat: 'no-repeat',
            }}
        >
            {/* covers first so values/text are never hidden by a later cover */}
            {config.fields.filter(f => f.kind === 'cover').map(f => <div key={f.id} style={visualItemStyle(f)} />)}
            {config.fields.filter(f => f.kind !== 'cover').map(f => (
                <div key={f.id} style={{ ...visualItemStyle(f), pointerEvents: 'none' }}>
                    {visualItemText(f, data)}
                </div>
            ))}
            {children}
        </div>
    );
}