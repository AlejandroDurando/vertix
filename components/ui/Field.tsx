"use client";

import { forwardRef, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type FieldShellProps = {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor: string;
  children: React.ReactNode;
};

export function FieldShell({ label, hint, error, required, htmlFor, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-vertix">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-vertix/50">{hint}</p>}
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

const baseInput =
  "w-full rounded-lg border border-vertix/15 bg-white px-3.5 py-2.5 text-sm text-vertix placeholder:text-vertix/30 outline-none transition focus:border-vertix focus:ring-2 focus:ring-vertix/15 disabled:cursor-not-allowed disabled:bg-vertix/5";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, required, id, className = "", ...rest },
  ref,
) {
  const inputId = id ?? rest.name ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={Boolean(error)}
        className={`${baseInput} ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : ""} ${className}`}
        {...rest}
      />
    </FieldShell>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, required, id, className = "", ...rest },
  ref,
) {
  const inputId = id ?? rest.name ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      <textarea
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={Boolean(error)}
        className={`${baseInput} min-h-[120px] resize-y ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : ""} ${className}`}
        {...rest}
      />
    </FieldShell>
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, required, options, placeholder, id, className = "", ...rest },
  ref,
) {
  const inputId = id ?? rest.name ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      <select
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={Boolean(error)}
        className={`${baseInput} appearance-none bg-[length:14px] bg-[right_14px_center] bg-no-repeat pr-9 ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : ""} ${className}`}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%231B2A4E'><path d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'/></svg>\")",
        }}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
});

type FileInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  hint?: string;
  error?: string;
};

export const FileInput = forwardRef<HTMLInputElement, FileInputProps>(function FileInput(
  { label, hint, error, required, id, className = "", ...rest },
  ref,
) {
  const inputId = id ?? rest.name ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      <input
        ref={ref}
        type="file"
        id={inputId}
        required={required}
        aria-invalid={Boolean(error)}
        className={`block w-full text-sm text-vertix file:mr-3 file:rounded-md file:border-0 file:bg-vertix file:px-3.5 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-vertix-dark ${className}`}
        {...rest}
      />
    </FieldShell>
  );
});
