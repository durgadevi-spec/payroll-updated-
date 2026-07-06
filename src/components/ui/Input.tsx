import { InputHTMLAttributes, forwardRef, ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  prefix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, prefix, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            {label}
            {props.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <div className="relative">
          {prefix && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            className={`w-full rounded-lg border text-sm transition-colors
              ${error
                ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
                : 'border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-blue-500/20'
              }
              bg-white dark:bg-slate-800 text-slate-800 dark:text-white
              placeholder:text-slate-400 dark:placeholder:text-slate-500
              px-3 py-2 focus:outline-none focus:ring-2
              disabled:opacity-50 disabled:cursor-not-allowed
              ${prefix ? 'pl-8' : ''}
              ${className}`}
            {...props}
          />
        </div>
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, error, options, className = '', ...props }: SelectProps) {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          {label}
          {props.required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <select
        className={`w-full rounded-lg border text-sm transition-colors
          ${error
            ? 'border-red-400 focus:border-red-500'
            : 'border-slate-300 dark:border-slate-600 focus:border-blue-500 focus:ring-blue-500/20'
          }
          bg-white dark:bg-slate-800 text-slate-800 dark:text-white
          px-3 py-2 focus:outline-none focus:ring-2
          disabled:opacity-50 disabled:cursor-not-allowed
          ${className}`}
        {...props}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
