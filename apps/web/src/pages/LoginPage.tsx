// PG-01 Login. E-mail and password against the configured AuthProvider (standalone: seeded fake accounts).
// Failure handling: a focusable error summary (linked to the fields), inline field errors, and plain messages that
// never reveal which part was wrong or whether an account exists.
import { LogIn } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { homeFor, useAuth } from '../auth/AuthContext';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { ErrorSummary, type FormError } from '../components/ui/ErrorSummary';
import { Input } from '../components/ui/Field';
import { LanguageToggle } from '../shell/LanguageToggle';
import { SimulatedDataBanner } from '../shell/SimulatedDataBanner';

const EMAIL_ID = 'login-email';
const PASSWORD_ID = 'login-password';

export function LoginPage() {
  const { t } = useTranslation('auth');
  const { user, login, sessionEnded, acknowledgeSessionEnded } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  // a ref, not state: two submits in the same tick must not both get through
  const inFlight = useRef(false);
  const [submitted, setSubmitted] = useState(0);

  // after a failed submit the error summary takes focus (so keyboard and screen-reader users land on the problem)
  useEffect(() => {
    if (submitted > 0) summaryRef.current?.focus();
  }, [submitted]);

  if (user) return <Navigate to={from ?? homeFor(user.role)} replace />;

  const errors: FormError[] = [
    ...(fieldErrors.email ? [{ fieldId: EMAIL_ID, message: fieldErrors.email }] : []),
    ...(fieldErrors.password ? [{ fieldId: PASSWORD_ID, message: fieldErrors.password }] : []),
    ...(formError ? [{ message: formError }] : []),
  ];

  function messageFor(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.status === 401) return t('auth:login.errors.invalid');
      if (error.status === 403) return t('auth:login.errors.notAllowed');
      if (error.status === 429 && error.code === 'ACCOUNT_LOCKED')
        return t('auth:login.errors.locked');
      if (error.status === 429) return t('auth:login.errors.rateLimited');
      if (error.status === 0) return t('auth:login.errors.network');
    }
    return t('auth:login.errors.generic');
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return; // a second Enter or click while a request is running does nothing
    const next: { email?: string; password?: string } = {};
    if (email.trim() === '') next.email = t('auth:login.errors.emailRequired');
    if (password === '') next.password = t('auth:login.errors.passwordRequired');
    setFieldErrors(next);
    setFormError(null);
    if (next.email || next.password) {
      setSubmitted((n) => n + 1);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const signedIn = await login(email.trim(), password);
      navigate(from ?? homeFor(signedIn.role), { replace: true });
    } catch (error) {
      setPassword(''); // never keep a rejected password in the field
      setFormError(messageFor(error));
      setSubmitted((n) => n + 1);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <SimulatedDataBanner />
      <header className="flex justify-end p-4">
        <LanguageToggle />
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-md flex-1 p-4">
        <h1 className="font-display text-3xl font-semibold text-ink">{t('common:appName')}</h1>
        <p className="mt-1 text-base text-body">{t('auth:login.intro')}</p>

        <form
          onSubmit={onSubmit}
          noValidate
          aria-labelledby="login-heading"
          className="mt-6 flex flex-col gap-4 rounded-lg border border-line bg-card p-5 shadow-card"
        >
          <h2 id="login-heading" className="text-xl font-semibold text-ink">
            {t('auth:login.heading')}
          </h2>

          {sessionEnded ? (
            <Banner kind="acknowledge" live title={t('auth:login.sessionEnded.title')}>
              {t('auth:login.sessionEnded.body')}
            </Banner>
          ) : null}

          <ErrorSummary ref={summaryRef} title={t('auth:login.errors.summary')} errors={errors} />

          <Input
            id={EMAIL_ID}
            label={t('auth:login.email')}
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            requiredText={t('common:status.required')}
            value={email}
            error={fieldErrors.email}
            onChange={(event) => {
              setEmail(event.target.value);
              acknowledgeSessionEnded();
            }}
          />
          <Input
            id={PASSWORD_ID}
            label={t('auth:login.password')}
            type="password"
            autoComplete="current-password"
            required
            requiredText={t('common:status.required')}
            value={password}
            error={fieldErrors.password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <Button type="submit" variant="primary" icon={LogIn} loading={busy}>
            {t('auth:login.submit')}
          </Button>
          <p className="text-xs text-body">{t('auth:login.hint')}</p>
        </form>
      </main>
    </div>
  );
}
