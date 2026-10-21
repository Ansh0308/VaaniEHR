// PG-14 Guideline pathways (doctor, admin): a READ-ONLY viewer. Nodes and edges, the text in en, gu and hi, the exact
// source sentence and page of every node, the version history and the reviewer sign-off. Anything that is not an active,
// signed-off pathway carries a plain "Draft - not clinically reviewed" banner. No editing here: a new version is made
// with the command line (docs/PATHWAY_AUTHORING.md). Cards, not a wide table, so it reads at 375px.
import { FileWarning, GitBranch, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorText } from '../api/errorText';
import type { Condition, NodeView, PathwayDetail, PathwayList, VersionInfo } from '../api/pathways';
import { useRequest } from '../api/useRequest';
import { useAuth } from '../auth/AuthContext';
import { NeedsReview } from '../components/NeedsReview';
import { Badge } from '../components/ui/Badge';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { EmptyState, Skeleton } from '../components/ui/Feedback';
import { Select } from '../components/ui/Field';

const LANGS = ['en', 'gu', 'hi'] as const;

const show = (c: Condition): string =>
  `${c.op} ${Array.isArray(c.value) ? c.value.join(', ') : String(c.value)}`;

function SignOff({ info }: { info: Pick<VersionInfo, 'signedOff' | 'reviewedBy' | 'reviewedOn'> }) {
  const { t } = useTranslation('pathways');
  return info.signedOff ? (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink">
      <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
      {t('pathways:signed', { by: info.reviewedBy, on: info.reviewedOn })}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
      <FileWarning aria-hidden="true" className="size-4 shrink-0" />
      {t('pathways:unsigned')}
    </span>
  );
}

function Localised({
  label,
  text,
}: {
  label: string;
  text: { en: string; gu: string; hi: string };
}) {
  const { t } = useTranslation('pathways');
  return (
    <div>
      <p className="text-xs font-semibold text-body">{label}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {LANGS.map((lang) => (
          <li key={lang} className="flex gap-2 text-base text-ink">
            <span className="w-16 shrink-0 text-xs font-semibold text-body">
              {t(`pathways:lang.${lang}`)}
            </span>
            <span lang={lang} className="min-w-0 flex-1">
              {text[lang]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NodeCard({ node }: { node: NodeView }) {
  const { t } = useTranslation('pathways');
  return (
    <li
      id={`node-${node.id}`}
      className="flex flex-col gap-3 rounded-md border border-line bg-card p-3"
      data-node={node.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{node.id}</span>
        <Badge>{t(`pathways:nodeType.${node.type}`)}</Badge>
        {node.slot ? (
          <span className="text-sm text-body">
            {t('pathways:slot', { slot: node.slot, answer: node.answer })}
          </span>
        ) : null}
        {node.redFlagIf ? (
          <Badge className="border-ink">
            {t('pathways:redFlag', { when: show(node.redFlagIf) })}
          </Badge>
        ) : null}
        {node.type === 'terminal' && node.refer !== null ? (
          <Badge>{node.refer ? t('pathways:refer.yes') : t('pathways:refer.no')}</Badge>
        ) : null}
        {node.infoWeight !== null ? (
          <span className="text-sm text-body">
            {t('pathways:weight', { weight: node.infoWeight })}
          </span>
        ) : null}
      </div>
      {node.ask ? <Localised label={t('pathways:ask')} text={node.ask} /> : null}
      {node.reason ? <Localised label={t('pathways:reason')} text={node.reason} /> : null}
      {node.label ? <Localised label={t('pathways:endLabel')} text={node.label} /> : null}
      {node.choices ? (
        <p className="text-sm text-body">
          {t('pathways:choices', { list: node.choices.join(', ') })}
        </p>
      ) : null}
      <div>
        <p className="text-xs font-semibold text-body">{t('pathways:sourceQuote')}</p>
        {node.sourceQuote ? (
          <blockquote className="mt-1 border-l-4 border-ink pl-3 text-base text-ink">
            {node.sourceQuote}
          </blockquote>
        ) : (
          <p className="mt-1 text-sm font-semibold text-ink">{t('pathways:noQuote')}</p>
        )}
        <p className="mt-1 text-sm text-body">
          {node.page !== null ? t('pathways:page', { page: node.page }) : t('pathways:noPage')}
          {node.reviewedBy ? ` - ${t('pathways:nodeReviewer', { by: node.reviewedBy })}` : ''}
          {node.conceptId ? ` - ${t('pathways:concept', { id: node.conceptId })}` : ''}
        </p>
      </div>
      {node.edges.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-body">{t('pathways:edges')}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {node.edges.map((e, i) => (
              <li key={i} className="text-base text-ink">
                {t('pathways:edge', { when: show(e), to: e.to })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

function Detail({ d, onVersion }: { d: PathwayDetail; onVersion: (v: number) => void }) {
  const { t } = useTranslation('pathways');
  return (
    <div className="flex flex-col gap-5">
      {d.notActive ? (
        <Banner kind="acknowledge" title={t('pathways:draftBanner')}>
          {d.status === 'test' ? t('pathways:testNote') : t('pathways:draftNote')}
        </Banner>
      ) : !d.signedOff ? (
        <Banner kind="acknowledge" title={t('pathways:draftBanner')}>
          {t('pathways:unsignedNote')}
        </Banner>
      ) : null}

      <section
        aria-label={t('pathways:summary')}
        className="rounded-lg border border-line bg-card p-4"
      >
        <h2 className="text-xl font-semibold text-ink">{d.title.en}</h2>
        <dl className="mt-3 grid gap-2 text-base sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold text-body">{t('pathways:fields.id')}</dt>
            <dd className="text-ink">{d.id}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-body">{t('pathways:fields.version')}</dt>
            <dd className="text-ink">{d.version}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-body">{t('pathways:fields.status')}</dt>
            <dd className="text-ink">{t(`pathways:status.${d.status}`)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-body">{t('pathways:fields.signoff')}</dt>
            <dd>
              <SignOff info={d} />
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold text-body">{t('pathways:fields.source')}</dt>
            <dd className="text-ink">
              {t('pathways:sourceLine', { doc: d.source.doc, page: d.source.page })}
            </dd>
          </div>
        </dl>
        <div className="mt-3">
          <Localised label={t('pathways:fields.title')} text={d.title} />
        </div>
      </section>

      <section
        aria-label={t('pathways:history')}
        className="rounded-lg border border-line bg-card p-4"
      >
        <h2 className="text-lg font-semibold text-ink">{t('pathways:history')}</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {d.versions.map((v) => (
            <li
              key={v.version}
              className="flex flex-wrap items-center gap-3 rounded-md border border-line p-2"
            >
              <span className="font-semibold text-ink">
                {t('pathways:versionN', { n: v.version })}
              </span>
              <Badge>{t(`pathways:status.${v.status}`)}</Badge>
              <SignOff info={v} />
              {v.version !== d.version ? (
                <Button onClick={() => onVersion(v.version)}>
                  {t('pathways:openVersion', { n: v.version })}
                </Button>
              ) : (
                <span className="text-sm text-body">{t('pathways:shown')}</span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-body">{t('pathways:newVersionHint')}</p>
      </section>

      <section aria-label={t('pathways:nodes')} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">{t('pathways:nodes')}</h2>
        <p className="text-sm text-body">{t('pathways:startsAt', { id: d.start })}</p>
        <ol className="flex flex-col gap-3">
          {d.nodes.map((n) => (
            <NodeCard key={n.id} node={n} />
          ))}
        </ol>
      </section>

      <section aria-label={t('pathways:rules')} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">{t('pathways:rules')}</h2>
        <ul className="flex flex-col gap-2">
          {d.rules.map((r) => (
            <li key={r.id} className="rounded-md border border-line bg-card p-2 text-base text-ink">
              {t('pathways:rule', {
                id: r.id,
                slot: r.slot,
                when: show({ op: r.op, value: r.value }),
                weight: r.weight,
              })}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function PathwaysPage() {
  const { t, i18n } = useTranslation('pathways');
  const { api } = useAuth();
  const list = useRequest(() => api.get<PathwayList>('/pathways'), [api]);
  const [picked, setPicked] = useState<string | null>(null);
  const [version, setVersion] = useState<number | undefined>(undefined);
  const first = list.state.status === 'ready' ? list.state.data.pathways[0]?.id : undefined;
  const id = picked ?? first ?? null;
  const detail = useRequest(
    () =>
      id
        ? api.get<PathwayDetail>(`/pathways/${id}`, version ? { version } : undefined)
        : Promise.resolve(null),
    [api, id, version],
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <header>
        <h1 className="font-display text-3xl font-semibold text-ink">{t('pathways:title')}</h1>
        <p className="mt-1 text-base text-body">{t('pathways:intro')}</p>
        {i18n.language === 'gu' ? <NeedsReview /> : null}
      </header>

      {list.state.status === 'loading' ? (
        <Skeleton lines={3} label={t('pathways:loading')} />
      ) : list.state.status === 'error' ? (
        <Banner
          kind="blocked"
          live
          actions={<Button onClick={list.reload}>{t('common:action.retry')}</Button>}
        >
          {errorText(t, list.state.error)}
        </Banner>
      ) : list.state.data.pathways.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title={t('pathways:empty.title')}
          description={t('pathways:empty.body')}
        />
      ) : (
        <>
          <Select
            label={t('pathways:pick')}
            value={id ?? ''}
            onChange={(event) => {
              setPicked(event.target.value);
              setVersion(undefined);
            }}
            options={list.state.data.pathways.map((p) => ({
              value: p.id,
              label: t('pathways:option', {
                title: p.title[i18n.language === 'gu' ? 'gu' : 'en'],
                id: p.id,
              }),
            }))}
          />
          {detail.state.status === 'loading' ? (
            <Skeleton lines={5} label={t('pathways:loading')} />
          ) : detail.state.status === 'error' ? (
            <Banner kind="blocked" live>
              {errorText(t, detail.state.error)}
            </Banner>
          ) : detail.state.data ? (
            <Detail d={detail.state.data} onVersion={setVersion} />
          ) : null}
        </>
      )}
    </div>
  );
}
