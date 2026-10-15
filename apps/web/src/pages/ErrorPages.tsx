// PG-19: error pages. 403 (role not allowed), 404 (no such page), 500 (something broke), plus the error boundary that
// shows the 500 page instead of a blank screen. Nothing technical (stack traces, server messages) is shown.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SearchX, ServerCrash, ShieldX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/Feedback';
import { useAuthOptional } from '../auth/useAuthOptional';
import { homeFor } from '../auth/AuthContext';

const linkClass =
  'inline-flex min-h-11 items-center rounded-md border border-transparent bg-action px-4 py-2 text-base font-semibold text-on-action hover:bg-action-hover';

function HomeLink() {
  const { t } = useTranslation('shell');
  const auth = useAuthOptional();
  return (
    <Link to={auth?.user ? homeFor(auth.user.role) : '/login'} className={linkClass}>
      {t('shell:errors.home')}
    </Link>
  );
}

function ErrorLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="mb-6 font-display text-3xl font-semibold text-ink">{title}</h1>
      {children}
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation('shell');
  return (
    <ErrorLayout title={t('shell:notFound.title')}>
      <EmptyState
        icon={SearchX}
        title={t('shell:notFound.heading')}
        description={t('shell:notFound.body')}
        headingLevel={2}
        action={<HomeLink />}
      />
    </ErrorLayout>
  );
}

export function ForbiddenPage() {
  const { t } = useTranslation('shell');
  return (
    <ErrorLayout title={t('shell:forbidden.title')}>
      <EmptyState
        icon={ShieldX}
        title={t('shell:forbidden.heading')}
        description={t('shell:forbidden.body')}
        headingLevel={2}
        action={<HomeLink />}
      />
    </ErrorLayout>
  );
}

export function ServerErrorPage({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation('shell');
  return (
    <ErrorLayout title={t('shell:serverError.title')}>
      <EmptyState
        icon={ServerCrash}
        title={t('shell:serverError.heading')}
        description={t('shell:serverError.body')}
        headingLevel={2}
        action={
          <div className="flex flex-wrap justify-center gap-3">
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-11 items-center rounded-md border border-control bg-card px-4 py-2 text-base font-semibold text-ink hover:bg-sunken"
              >
                {t('shell:serverError.retry')}
              </button>
            ) : null}
            <HomeLink />
          </div>
        }
      />
    </ErrorLayout>
  );
}

interface BoundaryState {
  failed: boolean;
}

/** Catches rendering errors anywhere below it and shows the 500 page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Technical detail goes to the developer console only, never to the screen.
    console.error('render error', error.name, info.componentStack?.split('\n')[1]?.trim());
  }

  override render(): ReactNode {
    if (this.state.failed)
      return <ServerErrorPage onRetry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}
