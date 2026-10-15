export interface PayslipTemplate {
  id?: string;
  name: string;
  is_default: boolean;
  content: PayslipTemplateContent;
  created_at?: string;
  updated_at?: string;
}

export type TemplateType = 'structured' | 'visual';

/**
 * Items you can place on top of an uploaded payslip image.
 *  - 'field' : a value pulled from payroll data (employee name, basic salary, ...)
 *  - 'text'  : a text box you type yourself (labels, company name, notes, ...)
 *  - 'cover' : a plain coloured rectangle used to hide something printed in the image
 * Templates saved before this existed have no `kind` and are treated as 'field'.
 */
export type VisualItemKind = 'field' | 'text' | 'cover';

export interface VisualField {
  id: string;
  name: string;
  key?: string; // Maps to payroll data (e.g. employee_name, net_salary)
  x: number; // Percentage 0-100 of page width (left edge)
  y: number; // Percentage 0-100 of page height (top edge)
  fontSize: number; // px on an 800px wide page
  fontWeight: string;
  color: string;
  label?: string; // Optional static text
  kind?: VisualItemKind;
  text?: string; // kind === 'text'
  width?: number; // % of page width. Unset = size to content.
  height?: number; // % of page height. Unset = size to content.
  align?: 'left' | 'center' | 'right';
  bgColor?: string; // Fill colour. Required for 'cover'; optional on fields/text to hide old values.
  showSymbol?: boolean; // money fields: prefix the rupee symbol
}

export interface PayslipTemplateRow {
  label: string;
  key: string;
  isTotal?: boolean;
  /** Hide this row on the rendered payslip/PDF when its amount is 0 (rows stay visible while editing). */
  hideIfZero?: boolean;
}

export interface PayslipTemplateContent {
  type?: TemplateType;
  visualConfig?: {
    backgroundImage: string;
    fields: VisualField[];
    /** image height / width. The page is drawn at exactly this shape so nothing stretches. */
    aspectRatio?: number;
  };
  header: {
    title: string;
    address: string;
    logoUrl?: string;
    logoText?: string;
    showLogo: boolean;
    backgroundImage?: string; // Base64 or URL
    backgroundOpacity?: number; // 10-100, how strongly the background image shows (default 40 = legacy look)
  };
  sections: {
    employeeDetails: {
      enabled: boolean;
      fields: { label: string; key: string }[];
    };
    attendanceDetails?: {
      enabled: boolean;
      title: string;
    };
    earnings: {
      title: string;
      rows: PayslipTemplateRow[];
    };
    deductions: {
      title: string;
      rows: PayslipTemplateRow[];
    };
    summary: {
      title: string;
      showNetPayInWords: boolean;
    };
    /** Leave balance table (Opening/Allotted/Avail./Encash./Adjust./Closing). Only drawn when balance data exists for the payslip. */
    leaveBalances?: {
      enabled: boolean;
      title: string;
    };
    footer: {
      remarks: string[];
      showGeneratedDate: boolean;
      /** Line shown under the Leave Balances table, e.g. "No reimbursements claimed for this month." */
      reimbursementsNote?: string;
      /** e.g. "HR / Payroll Team — Concept Trunk Interiors" */
      preparedBy?: string;
    };
  };
}