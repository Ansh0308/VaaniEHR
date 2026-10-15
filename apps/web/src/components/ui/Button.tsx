import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn, TARGET } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-action text-on-action hover:bg-action-hover border border-transparent',
  secondary: 'bg-card text-ink border border-control hover:bg-sunken',
  ghost: 'bg-transparent text-ink border border-transparent hover:bg-sunken',
};

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-base font-semibold ' +
  'transition-colors duration-(--motion-fast) disabled:cursor-not-allowed disabled:opacity-60 ' +
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: LucideIcon;
  /** Shows a spinner, sets aria-busy and ignores clicks. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    icon: Icon,
    loading = false,
    className,
    children,
    onClick,
    type,
    ...rest
  },
  ref,
) {
  const { t } = useTranslation('common');
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(BASE, TARGET, VARIANT[variant], className)}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
      {...rest}
    >
      {loading ? (
        <>
          <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" />
          <span className="sr-only">{t('status.loading')}</span>
        </>
      ) : Icon ? (
        <Icon aria-hidden="true" className="size-5 shrink-0" />
      ) : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  icon: LucideIcon;
  /** Required accessible name; icon-only buttons must always have one. */
  label: string;
  variant?: Variant;
  children?: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, variant = 'ghost', className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors duration-(--motion-fast)',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'size-11',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden="true" className="size-5" />
    </button>
  );
});
