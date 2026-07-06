import React from 'react';
import { PayslipFull, PayslipTemplateContent } from '../../types';
import { formatCurrency, getMonthName } from '../../lib/payrollCalculator';
import { numberToWords } from '../../lib/numberToWords';
import { Plus, Trash2 } from 'lucide-react';

interface Props {
  payslip: PayslipFull;
  templateContent?: PayslipTemplateContent;
  editable?: boolean;
  onUpdateValue?: (key: string, value: number) => void;
  onUpdateLabel?: (section: 'earnings' | 'deductions', index: number, label: string) => void;
  onRemoveRow?: (section: 'earnings' | 'deductions', index: number) => void;
  onAddRow?: (section: 'earnings' | 'deductions') => void;
}

export function PayslipDocument({ payslip, templateContent, editable, onUpdateValue, onUpdateLabel, onRemoveRow, onAddRow }: Props) {
  const item = payslip.payroll_item;
  const emp = payslip.employee;
  const pal = payslip.payroll;

  if (!item || !emp) return null;

  const header = templateContent?.header || {
    title: 'Acme Corp Pvt Ltd',
    address: '123, Business Park, Bangalore - 560001',
    showLogo: true,
    logoText: 'AC'
  };

  const perDaySalary = (item.monthly_salary || 0) / (item.working_days || 30);
  const sundayEarnings = Math.round(perDaySalary * (item.sunday_work_days || 0) * 100) / 100;

  // Map values to labels based on template rows if available
  const earnings = templateContent?.sections.earnings.rows.map(row => {
    let value = 0;
    if (row.key === 'monthly_salary' || row.key === 'basic_salary') value = item.monthly_salary;
    else if (row.key === 'sunday_work_earnings') value = sundayEarnings;
    else if (row.key === 'bonus') value = item.bonus || 0;
    else if (row.key === 'hra') value = 0;
    else if (row.key === 'conveyance') value = 0;
    else if (row.key === 'medical') value = 0;
    return { label: row.label, value, key: row.key === 'sunday_work_earnings' ? undefined : (row.key === 'basic_salary' ? 'monthly_salary' : row.key) };
  }) || [
    { label: 'Monthly Salary', value: item.monthly_salary, key: 'monthly_salary' },
    { label: 'Sunday Work Earnings', value: sundayEarnings },
    { label: 'Special Allowance', value: item.bonus || 0, key: 'bonus' },
  ];

  const deductions = templateContent?.sections.deductions.rows.map(row => {
    let value = 0;
    if (row.key === 'lop') value = item.leave_deduction + item.timesheet_deduction;
    else if (row.key === 'pf') value = item.pf_deduction;
    else if (row.key === 'esi') value = item.esi_deduction;
    else if (row.key === 'tax') value = item.tax_deduction;
    else if (row.key === 'loan') value = item.loan_deduction;
    else if (row.key === 'advance') value = item.advance_deduction;
    return { label: row.label, value, key: row.key };
  }) || [
    { label: 'LOP', value: item.leave_deduction + item.timesheet_deduction, key: 'lop' },
    { label: 'PF', value: item.pf_deduction, key: 'pf' },
    { label: 'ESI', value: item.esi_deduction, key: 'esi' },
    { label: 'TDS/Tax', value: item.tax_deduction, key: 'tax' },
    { label: 'Advance', value: item.advance_deduction, key: 'advance' },
  ];

  if (templateContent?.type === 'visual' && templateContent.visualConfig?.backgroundImage) {
    return (
      <div 
        className="relative shadow-2xl bg-white"
        style={{ 
          width: '800px', 
          height: '1131px',
          backgroundImage: `url(${templateContent.visualConfig.backgroundImage})`,
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat'
        }}
      >
        {templateContent.visualConfig.fields.map(field => {
          let displayValue = '';
          switch(field.key) {
            case 'employee_name': displayValue = emp.name; break;
            case 'employee_code': displayValue = emp.id; break;
            case 'net_salary': displayValue = formatCurrency(item.net_salary); break;
            case 'month_year': displayValue = `${getMonthName(pal?.month || 1)} ${pal?.year || 2026}`; break;
            case 'monthly_salary':
            case 'basic_salary': displayValue = formatCurrency(item.monthly_salary); break;
            case 'total_earnings': displayValue = formatCurrency(item.net_salary + item.pf_deduction + item.esi_deduction + item.tax_deduction); break;
            case 'total_deductions': displayValue = formatCurrency(item.pf_deduction + item.esi_deduction + item.tax_deduction + item.advance_deduction); break;
            default: displayValue = field.name;
          }
          return (
            <div
              key={field.id}
              style={{
                position: 'absolute',
                left: `${field.x}%`,
                top: `${field.y}%`,
                fontSize: `${field.fontSize}px`,
                fontWeight: field.fontWeight as any,
                color: field.color,
                whiteSpace: 'nowrap',
                pointerEvents: 'none'
              }}
            >
              {displayValue}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div 
      className="bg-white p-10 max-w-[850px] mx-auto shadow-xl relative overflow-hidden border border-slate-300" 
      style={{ 
        minHeight: '1100px',
        fontFamily: 'Inter, system-ui, sans-serif',
        backgroundImage: header.backgroundImage ? `url(${header.backgroundImage})` : 'none',
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center'
      }}
    >
      {header.backgroundImage && <div className="absolute inset-0 bg-white/60 pointer-events-none" />}
      
      <div className="relative z-10 h-full flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center mb-8 border-b-2 border-slate-900 pb-6 gap-6">
          <div className="flex items-center gap-6 flex-1 min-w-0">
            {header.showLogo && (
              <div className="w-20 h-20 bg-black flex-shrink-0 flex items-center justify-center text-white font-black rounded-lg overflow-hidden shadow-md">
                {header.logoUrl ? (
                  <img src={header.logoUrl} alt="Logo" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl tracking-widest">{header.logoText}</span>
                )}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tighter break-words leading-none mb-2">{header.title}</h1>
              <p className="text-[11px] text-slate-600 font-medium leading-relaxed max-w-[450px]">{header.address}</p>
            </div>
          </div>
          <div className="text-right shrink-0 border-l-2 border-slate-200 pl-6">
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">PAY SLIP</h2>
            <p className="text-sm font-bold text-blue-600 uppercase mt-1">{pal ? `${getMonthName(pal.month)} ${pal.year}` : 'AUGUST 2026'}</p>
          </div>
        </div>

        {/* Employee Details */}
        <table className="w-full border-collapse mb-8 text-xs">
          <tbody>
            <tr>
              <td className="border border-slate-400 p-2.5 font-bold bg-slate-50 w-1/4">Employee Code</td>
              <td className="border border-slate-400 p-2.5 w-1/4 uppercase">{emp.id?.substring(0, 8) || '—'}</td>
              <td className="border border-slate-400 p-2.5 font-bold bg-slate-50 w-1/4">Employee Name</td>
              <td className="border border-slate-400 p-2.5 w-1/4 uppercase font-semibold">{emp.name || '—'}</td>
            </tr>
            <tr>
              <td className="border border-slate-400 p-2.5 font-bold bg-slate-50">Designation</td>
              <td className="border border-slate-400 p-2.5 uppercase">{emp.designation || '—'}</td>
              <td className="border border-slate-400 p-2.5 font-bold bg-slate-50">Department</td>
              <td className="border border-slate-400 p-2.5 uppercase">{emp.department || '—'}</td>
            </tr>
            <tr>
              <td className="border border-slate-400 p-2.5 font-bold bg-slate-50">Bank (A/C)</td>
              <td className="border border-slate-400 p-2.5 font-mono">{emp.bank_account || '—'}</td>
              <td className="border border-slate-400 p-2.5 font-bold bg-slate-50">Calculation Mode</td>
              <td className="border border-slate-400 p-2.5 uppercase font-semibold text-blue-600">{item.calculation_type || 'monthly'}</td>
            </tr>
            <tr>
              <td className="border border-slate-400 p-2.5 font-bold bg-slate-50">Payable Days</td>
              <td className="border border-slate-400 p-2.5 font-semibold text-blue-600">{item.working_days || '0'} Days</td>
              <td className="border border-slate-400 p-2.5 font-bold bg-slate-50">Days Considered</td>
              <td className="border border-slate-400 p-2.5 font-semibold text-blue-600">{item.calculation_days || item.working_days || '0'} Days</td>
            </tr>
          </tbody>
        </table>

        {/* Earnings & Deductions */}
        <div className="flex gap-0 mb-8">
          {/* Earnings */}
          <table className="w-1/2 border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="border border-slate-900 p-2.5 text-left relative group">
                  {templateContent?.sections.earnings.title || 'EARNINGS'}
                  {editable && (
                    <button 
                      onClick={() => onAddRow?.('earnings')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 bg-blue-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Plus size={10} />
                    </button>
                  )}
                </th>
                <th className="border border-slate-900 p-2.5 text-right w-32">Amount (INR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {earnings.map((e, index) => (
                <tr key={index}>
                  <td className="border border-slate-300 p-2.5 relative group">
                    {editable ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={e.label}
                          onChange={(ev) => onUpdateLabel?.('earnings', index, ev.target.value)}
                          className="w-full bg-transparent border-none focus:ring-0 p-0 text-[11px]"
                        />
                        <button
                          onClick={() => onRemoveRow?.('earnings', index)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-50 rounded"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ) : (
                      e.label
                    )}
                  </td>
                  <td className="border border-slate-300 p-2.5 text-right font-medium">{formatCurrency(e.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Deductions */}
          <table className="w-1/2 border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="border border-slate-900 p-2.5 text-left relative group">
                  {templateContent?.sections.deductions.title || 'DEDUCTIONS'}
                  {editable && (
                    <button 
                      onClick={() => onAddRow?.('deductions')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Plus size={10} />
                    </button>
                  )}
                </th>
                <th className="border border-slate-900 p-2.5 text-right w-32">Amount (INR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {deductions.map((d, index) => (
                <tr key={index}>
                  <td className="border border-slate-300 p-2.5 relative group">
                    {editable ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={d.label}
                          onChange={(ev) => onUpdateLabel?.('deductions', index, ev.target.value)}
                          className="w-full bg-transparent border-none focus:ring-0 p-0 text-[11px]"
                        />
                        <button
                          onClick={() => onRemoveRow?.('deductions', index)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-50 rounded"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ) : (
                      d.label
                    )}
                  </td>
                  <td className="border border-slate-300 p-2.5 text-right font-medium">{formatCurrency(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Net Salary Section */}
        <div className="mt-auto">
          <div className="flex justify-between items-center bg-slate-900 text-white p-4 rounded-lg shadow-lg mb-8">
            <div>
              <p className="text-[10px] uppercase font-bold tracking-widest opacity-80">Net Payable Amount</p>
              <p className="text-xs italic opacity-70 mt-1">({numberToWords(item.net_salary)} Only)</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black tracking-tighter">{formatCurrency(item.net_salary)}</p>
            </div>
          </div>

          {/* Footer / Remarks */}
          <div className="grid grid-cols-2 gap-12 items-end">
            <div className="space-y-4">
              {templateContent?.sections.footer.remarks.length ? (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2 tracking-widest">Notes & Remarks</h4>
                  <ul className="list-disc list-inside space-y-1">
                    {templateContent.sections.footer.remarks.map((r, i) => (
                      <li key={i} className="text-[10px] text-slate-600 leading-tight">{r}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="h-20" /> 
              )}
              <p className="text-[9px] text-slate-400 italic">This is a computer-generated payslip and does not require a physical signature.</p>
            </div>
            
            <div className="flex flex-col items-center gap-2">
              <div className="w-full border-b border-slate-400 h-16" />
              <p className="text-[10px] font-bold text-slate-700 uppercase tracking-widest">Authorized Signatory</p>
              <p className="text-[9px] text-slate-400">{header.title}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
