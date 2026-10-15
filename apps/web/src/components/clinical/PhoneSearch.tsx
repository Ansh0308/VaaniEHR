// Phone box with instant match. The result is announced politely ("Searching", "Patient found", "No patient found").
import { Search } from 'lucide-react';
import { forwardRef, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { errorText } from '../../api/errorText';
import type { ApiError } from '../../api/client';
import type { LookupStatus } from '../../api/usePatientLookup';
import { Button } from '../ui/Button';
import { Input } from '../ui/Field';

export const PhoneSearch = forwardRef<
  HTMLInputElement,
  {
    phone: string;
    onPhone: (value: string) => void;
    status: LookupStatus;
    error: ApiError | null;
    onSubmit: () => void;
  }
>(function PhoneSearch({ phone, onPhone, status, error, onSubmit }, ref) {
  const { t } = useTranslation('patients');
  const message =
    status === 'searching'
      ? t('patients:lookup.searching')
      : status === 'found'
        ? t('patients:lookup.found')
        : status === 'notFound'
          ? t('patients:lookup.notFound')
          : status === 'error'
            ? errorText(t, error)
            : '';
  return (
    <form
      noValidate
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <Input
            ref={ref}
            label={t('patients:lookup.label')}
            hint={t('patients:lookup.hint')}
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            value={phone}
            onChange={(event) => onPhone(event.target.value)}
            {...(status === 'invalid' ? { error: t('patients:lookup.invalid') } : {})}
          />
        </div>
        <Button type="submit" variant="primary" icon={Search} loading={status === 'searching'}>
          {t('patients:lookup.find')}
        </Button>
      </div>
      <p role="status" className="min-h-5 text-sm text-body">
        {message}
      </p>
    </form>
  );
});
