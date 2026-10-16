import { ChevronDown } from 'lucide-react';
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';

const CONTROL =
  'block w-full min-h-11 rounded-md border bg-card px-3 py-2 text-base text-ink ' +
  'placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60';

interface FieldWrapProps {
  label: string;
  hint?: string;
  /** Error text shown under the control and announced via aria-describedby; sets aria-invalid. */
  error?: string;
  required?: boolean;
  /** Text appended to the label when required, e.g. "(required)". */
  requiredText?: string;
}

function describedBy(...ids: Array<string | undefined>): string | undefined {
  const list = ids.filter(Boolean).join(' ');
  return list.length > 0 ? list : undefined;
}

function FieldFrame({
  id,
  label,
  hint,
  error,
  required,
  requiredText,
  children,
}: FieldWrapProps & { id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
        {required && requiredText ? (
          <span className="font-normal text-body"> ({requiredText})</span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-body">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-semibold text-blocked-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>, FieldWrapProps {
  id?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, requiredText, id, className, required, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldFrame
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      requiredText={requiredText}
    >
      <input
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(
          hint ? `${fieldId}-hint` : undefined,
          error ? `${fieldId}-error` : undefined,
        )}
        className={cn(
          CONTROL,
          'field-focus',
          error ? 'border-blocked-accent' : 'border-control',
          className,
        )}
        {...rest}
      />
    </FieldFrame>
  );
});

export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>, FieldWrapProps {
  id?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, requiredText, id, className, required, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldFrame
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      requiredText={requiredText}
    >
      <textarea
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(
          hint ? `${fieldId}-hint` : undefined,
          error ? `${fieldId}-error` : undefined,
        )}
        className={cn(
          CONTROL,
          'min-h-24',
          error ? 'border-blocked-accent' : 'border-control',
          className,
        )}
        {...rest}
      />
    </FieldFrame>
  );
});

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'>, FieldWrapProps {
  id?: string;
  options: SelectOption[];
}

/** Native <select>: keyboard, screen reader and mobile behaviour come for free; only the frame is styled. */
export function Select({
  label,
  hint,
  error,
  requiredText,
  id,
  options,
  className,
  required,
  ...rest
}: SelectProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldFrame
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      requiredText={requiredText}
    >
      <div className="relative">
        <select
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(
            hint ? `${fieldId}-hint` : undefined,
            error ? `${fieldId}-error` : undefined,
          )}
          className={cn(
            CONTROL,
            'appearance-none pr-10',
            error ? 'border-blocked-accent' : 'border-control',
            className,
          )}
          {...rest}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-ink"
        />
      </div>
    </FieldFrame>
  );
}
