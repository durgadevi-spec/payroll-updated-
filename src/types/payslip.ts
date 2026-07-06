export interface PayslipTemplate {
  id?: string;
  name: string;
  is_default: boolean;
  content: PayslipTemplateContent;
  created_at?: string;
  updated_at?: string;
}

export type TemplateType = 'structured' | 'visual';

export interface VisualField {
  id: string;
  name: string;
  key?: string; // Maps to payroll data (e.g. employee_name, net_salary)
  x: number; // Percentage 0-100
  y: number; // Percentage 0-100
  fontSize: number;
  fontWeight: string;
  color: string;
  label?: string; // Optional static text
}

export interface PayslipTemplateContent {
  type?: TemplateType;
  visualConfig?: {
    backgroundImage: string;
    fields: VisualField[];
  };
  header: {
    title: string;
    address: string;
    logoUrl?: string;
    logoText?: string;
    showLogo: boolean;
    backgroundImage?: string; // Base64 or URL
  };
  sections: {
    employeeDetails: {
      enabled: boolean;
      fields: { label: string; key: string }[];
    };
    earnings: {
      title: string;
      rows: { label: string; key: string }[];
    };
    deductions: {
      title: string;
      rows: { label: string; key: string; isTotal?: boolean }[];
    };
    summary: {
      title: string;
      showNetPayInWords: boolean;
    };
    footer: {
      remarks: string[];
      showGeneratedDate: boolean;
    };
  };
}
