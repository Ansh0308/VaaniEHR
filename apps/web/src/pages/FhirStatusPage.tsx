// FHIR status for the admin (and the doctor): the validator's verdict and every error and warning for a signed visit, found by
// its session code. The admin sees no clinical content (the bundle itself is not sent to the admin). Phase 9A, ADR-D40.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { FhirTab } from '../components/clinical/FhirTab';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Field';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function FhirStatusPage() {
  const { t } = useTranslation('consult');
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(sessionId ?? '');
  const valid = UUID.test(code.trim());
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold text-ink">
          {t('consult:fhirStatus.title')}
        </h1>
        <p className="mt-1 text-base text-body">{t('consult:fhirStatus.intro')}</p>
      </header>
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) navigate(`/admin/fhir/${code.trim()}`);
        }}
      >
        <div className="min-w-64 flex-1">
          <Input
            label={t('consult:fhirStatus.code')}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            error={code && !valid ? t('consult:fhirStatus.codeInvalid') : undefined}
          />
        </div>
        <Button type="submit" variant="primary" disabled={!valid}>
          {t('consult:fhirStatus.show')}
        </Button>
      </form>
      {sessionId ? (
        <FhirTab key={sessionId} sessionId={sessionId} version={null} canBuild={false} />
      ) : null}
    </div>
  );
}
