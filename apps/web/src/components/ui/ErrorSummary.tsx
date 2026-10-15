// Error summary for a failed form submit (WCAG 3.3.1): sits at the top of the form, takes focus after a failed submit,
// and links each item to its field. Inline errors stay on the fields; this complements them. Icon + text, not colour alone.
import { Ban } from 'lucide-react';
import { forwardRef, useId } from 'react';
import { STATE_STYLES } from '../../design/states';
import { cn } from './cn';

export interface FormError {
  /** id of the field the message is about, or undefined for a message about the whole form */
  fieldId?: string;
  message: string;
}

export const ErrorSummary = forwardRef<HTMLDivElement, { title: string; errors: FormError[] }>(
  function ErrorSummary({ title, errors }, ref) {
    const titleId = useId();
    if (errors.length === 0) return null;
    return (
      <div
        ref={ref}
        role="alert"
        tabIndex={-1}
        aria-labelledby={titleId}
        className={cn('rounded-md p-3 text-sm', STATE_STYLES.blocked.panel)}
      >
        <p id={titleId} className="flex items-center gap-2 font-semibold">
          <Ban aria-hidden="true" className={cn('size-5 shrink-0', STATE_STYLES.blocked.icon)} />
          {title}
        </p>
        <ul className="mt-2 list-disc ps-6">
          {errors.map((error) => (
            <li key={`${error.fieldId ?? 'form'}-${error.message}`}>
              {error.fieldId ? (
                <a
                  href={`#${error.fieldId}`}
                  className="inline-flex min-h-11 items-center font-semibold underline"
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(error.fieldId as string)?.focus();
                  }}
                >
                  {error.message}
                </a>
              ) : (
                error.message
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  },
);
