// /design: Storybook-style demo of the Phase 1.2 design system (tokens, typography, safety states, base and clinical
// components). Everything shown is FAKE or placeholder content; nothing here is clinical guidance (Hard Rule 3).
import { Inbox, Save, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCard } from '../components/clinical/AlertCard';
import { ConsentPanel, type ConsentState } from '../components/clinical/ConsentPanel';
import { DiagnosisCandidate } from '../components/clinical/DiagnosisCandidate';
import { FactChip } from '../components/clinical/FactChip';
import { MedicineRow } from '../components/clinical/MedicineRow';
import { QuestionCard } from '../components/clinical/QuestionCard';
import { RecordBar, type RecordState } from '../components/clinical/RecordBar';
import { TranscriptPane, type TranscriptSegment } from '../components/clinical/TranscriptPane';
import { NeedsReview } from '../components/NeedsReview';
import { Badge, Chip, StateBadge } from '../components/ui/Badge';
import { Banner } from '../components/ui/Banner';
import { Button, IconButton } from '../components/ui/Button';
import { Combobox, type ComboboxOption } from '../components/ui/Combobox';
import { DiffViewer } from '../components/ui/DiffViewer';
import { EmptyState, Skeleton } from '../components/ui/Feedback';
import { Input, Select, TextArea } from '../components/ui/Field';
import { Drawer, Modal } from '../components/ui/Overlay';
import { Stepper } from '../components/ui/Stepper';
import { Table, type Column, type SortState } from '../components/ui/Table';
import { Tabs } from '../components/ui/Tabs';
import { useToast } from '../components/ui/Toast';
import { Tooltip } from '../components/ui/Tooltip';
import { useDemoSession, ROLES, type Role } from '../demo/session';
import { SAFETY_STATES, STATE_STYLES } from '../design/states';

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-4">
      <div>
        <h2 id={`${id}-h`} className="text-2xl font-semibold text-ink">
          {title}
        </h2>
        {intro ? <p className="mt-1 max-w-prose text-base text-body">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Demo({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <h3 className="mb-3 text-lg font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

const COLOR_TOKENS = [
  '--surface-page',
  '--surface-card',
  '--surface-sunken',
  '--text-primary',
  '--text-body',
  '--text-muted',
  '--action-primary',
  '--state-clear-bg',
  '--state-acknowledge-bg',
  '--state-blocked-bg',
  '--state-unconfirmed-bg',
  '--state-ai-bg',
] as const;

function Swatches() {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    setValues(
      Object.fromEntries(
        COLOR_TOKENS.map((token) => [token, styles.getPropertyValue(token).trim()]),
      ),
    );
  }, []);
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
      {COLOR_TOKENS.map((token) => (
        <li key={token} className="rounded-md border border-control bg-card p-2">
          <span
            aria-hidden="true"
            className="block h-10 rounded-sm border border-control"
            style={{ background: `var(${token})` }}
          />
          <code className="mt-1 block text-xs break-all text-ink">{token}</code>
          <span className="text-xs text-body">{values[token] ?? ''}</span>
        </li>
      ))}
    </ul>
  );
}

/** Type and shadow specimens: technical labels, not UI copy. */
const TYPE_SPECIMENS: ReadonlyArray<readonly [string, string]> = [
  ['text-xs', 'xs 13px'],
  ['text-sm', 'sm 15px'],
  ['text-base', 'base 16px'],
  ['text-xl', 'xl 20px'],
  ['text-3xl', '3xl 30px'],
];
const SHADOW_SPECIMENS: ReadonlyArray<readonly [string, string]> = [
  ['shadow-card', 'card'],
  ['shadow-overlay', 'overlay'],
];
const RADIUS_SPECIMENS: ReadonlyArray<readonly [string, string]> = [
  ['rounded-sm', 'sm 8px'],
  ['rounded-md', 'md 12px'],
  ['rounded-lg', 'lg 16px'],
];
/** Demo data (FAKE), kept out of the JSX on purpose. */
const COMBO_PLACEHOLDER = 'Drug-';
const FAKE_ENGINE = 'mock-engine';

interface PatientRow {
  id: string;
  token: number;
  name: string;
  state: 'clear' | 'acknowledge' | 'blocked';
}

export function DesignPage() {
  const { t, i18n } = useTranslation('design');
  const en = i18n.getFixedT('en', 'design');
  const gu = i18n.getFixedT('gu', 'design');
  const toast = useToast();
  const { role, setRole } = useDemoSession();

  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedMedicine, setSelectedMedicine] = useState<ComboboxOption | null>(null);
  const [chipSelected, setChipSelected] = useState(true);
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [consent, setConsent] = useState<ConsentState>({
    audio: false,
    aiProcessing: false,
    whatsapp: false,
  });
  const [sort, setSort] = useState<SortState>({ key: 'token', direction: 'ascending' });
  const [stepId, setStepId] = useState('consent');
  const [selectedCandidate, setSelectedCandidate] = useState(1);

  const medicines = useMemo<ComboboxOption[]>(
    () => [
      { id: 'a', label: 'Drug-A', secondary: '500 mg tablet', meta: 'FAKE_FOR_TEST' },
      { id: 'b', label: 'Drug-B', secondary: '250 mg capsule', meta: 'FAKE_FOR_TEST' },
      { id: 'c', label: 'Drug-C', secondary: '5 ml syrup', meta: 'FAKE_FOR_TEST' },
      { id: 'd', label: 'Toy-Drug-D', secondary: '10 mg tablet', meta: 'FAKE_FOR_TEST' },
    ],
    [],
  );

  const rows = useMemo<PatientRow[]>(() => {
    const data: PatientRow[] = [
      { id: 'r1', token: 3, name: 'Fake Patient Three', state: 'acknowledge' },
      { id: 'r2', token: 1, name: 'Fake Patient One', state: 'clear' },
      { id: 'r3', token: 2, name: 'Fake Patient Two', state: 'blocked' },
    ];
    const direction = sort?.direction === 'descending' ? -1 : 1;
    return [...data].sort(
      (a, b) =>
        (sort?.key === 'name' ? a.name.localeCompare(b.name) : a.token - b.token) * direction,
    );
  }, [sort]);

  const columns: Column<PatientRow>[] = [
    {
      key: 'token',
      header: t('design:table.token'),
      sortable: true,
      render: (row) => `#${row.token}`,
    },
    { key: 'name', header: t('design:table.name'), sortable: true, render: (row) => row.name },
    {
      key: 'state',
      header: t('design:table.status'),
      render: (row) => <StateBadge state={row.state} />,
    },
  ];

  const segments: TranscriptSegment[] = [
    {
      id: 's1',
      speaker: 'doctor',
      lang: 'en',
      final: true,
      text: en('design:demo.transcript.doctor'),
    },
    {
      id: 's2',
      speaker: 'patient',
      lang: 'gu',
      final: true,
      text: gu('design:demo.transcript.patient'),
      lowConfidence: [gu('design:demo.transcript.unsure')],
    },
    {
      id: 's3',
      speaker: 'doctor',
      lang: 'en',
      final: false,
      text: en('design:demo.transcript.partial'),
    },
  ];

  const diffBefore = [
    en('design:demo.diff.l1'),
    en('design:demo.diff.l2'),
    en('design:demo.diff.l3'),
  ];
  const diffAfter = [
    en('design:demo.diff.l1'),
    en('design:demo.diff.l2b'),
    en('design:demo.diff.l3'),
    en('design:demo.diff.l4'),
  ];

  const steps = [
    { id: 'consent', label: t('design:stepper.consent') },
    { id: 'record', label: t('design:stepper.record') },
    { id: 'review', label: t('design:stepper.review') },
    { id: 'sign', label: t('design:stepper.sign') },
  ];

  const roleOptions = ROLES.map((r) => ({ value: r, label: t(`shell:role.${r}`) }));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10">
      <header>
        <h1 className="font-display text-3xl font-semibold text-ink">{t('design:title')}</h1>
        <p className="mt-2 max-w-prose text-base text-body">{t('design:lead')}</p>
        <div className="mt-4 max-w-sm">
          <Select
            label={t('design:demoRole')}
            hint={t('design:demoRoleHint')}
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            options={roleOptions}
          />
        </div>
      </header>

      <Section id="tokens" title={t('design:tokens.title')} intro={t('design:tokens.intro')}>
        <Swatches />
        <div className="grid gap-4 md:grid-cols-3">
          <Demo title={t('design:tokens.radius')}>
            <div className="flex items-end gap-3">
              {RADIUS_SPECIMENS.map(([cls, label]) => (
                <span
                  key={cls}
                  className={`flex size-16 items-center justify-center border border-control bg-sunken text-xs text-ink ${cls}`}
                >
                  {label}
                </span>
              ))}
            </div>
          </Demo>
          <Demo title={t('design:tokens.shadow')}>
            <div className="flex gap-3">
              {SHADOW_SPECIMENS.map(([cls, label]) => (
                <span
                  key={cls}
                  className={`flex size-16 items-center justify-center rounded-md bg-card text-xs text-ink ${cls}`}
                >
                  {label}
                </span>
              ))}
            </div>
          </Demo>
          <Demo title={t('design:tokens.type')}>
            {TYPE_SPECIMENS.map(([cls, label]) => (
              <p key={cls} className={`${cls} text-ink`}>
                {label}
              </p>
            ))}
          </Demo>
        </div>
      </Section>

      <Section
        id="typography"
        title={t('design:typography.title')}
        intro={t('design:typography.intro')}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Demo title={t('design:typography.english')}>
            <p lang="en" className="font-display text-2xl font-semibold text-ink">
              {en('design:typography.sampleTitle')}
            </p>
            <p lang="en" className="mt-2 text-base text-body">
              {en('design:typography.sampleBody')}
            </p>
          </Demo>
          <Demo title={t('design:typography.gujarati')}>
            <p lang="gu" className="font-display text-2xl font-semibold text-ink">
              {gu('design:typography.sampleTitle')}
            </p>
            <p lang="gu" className="mt-2 text-base text-body">
              {gu('design:typography.sampleBody')}
            </p>
            <NeedsReview />
          </Demo>
        </div>
        <Demo title={t('design:typography.safeguardTitle')}>
          <p className="mb-2 text-sm text-body">{t('design:typography.safeguardBody')}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <p
              lang="en"
              style={{ textTransform: 'uppercase', letterSpacing: '0.2em', fontStyle: 'italic' }}
              className="text-base text-ink"
            >
              {en('design:typography.safeguardLatin')}
            </p>
            <div>
              <p
                lang="gu"
                style={{ textTransform: 'uppercase', letterSpacing: '0.2em', fontStyle: 'italic' }}
                className="text-base text-ink"
              >
                {gu('design:typography.safeguardGujarati')}
              </p>
              <NeedsReview />
            </div>
          </div>
        </Demo>
      </Section>

      <Section id="states" title={t('design:states.title')} intro={t('design:states.intro')}>
        <div className="grid gap-4 lg:grid-cols-2">
          {SAFETY_STATES.map((state) => (
            <div
              key={state}
              className={`flex flex-col gap-2 rounded-lg p-4 ${STATE_STYLES[state].panel}`}
              data-testid={`state-${state}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <StateBadge state={state} />
                <span className="text-sm">{t(`common:${STATE_STYLES[state].descKey}`)}</span>
              </div>
              <p lang="en" className="text-base">
                <span className="font-semibold">{t('design:states.exampleEn')}: </span>
                {en(`design:states.examples.${state}`)}
              </p>
              <div>
                <p lang="gu" className="text-base">
                  <span className="font-semibold">{t('design:states.exampleGu')}: </span>
                  {gu(`design:states.examples.${state}`)}
                </p>
                <NeedsReview />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="base" title={t('design:base.title')} intro={t('design:base.intro')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Demo title={t('design:base.buttons')}>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={Save}>
                {t('design:base.primary')}
              </Button>
              <Button>{t('design:base.secondary')}</Button>
              <Button variant="ghost">{t('design:base.ghost')}</Button>
              <Button loading>{t('design:base.loading')}</Button>
              <Button disabled>{t('design:base.disabled')}</Button>
              <IconButton icon={Search} label={t('design:base.iconButton')} variant="secondary" />
            </div>
          </Demo>
          <Demo title={t('design:base.fields')}>
            <div className="flex flex-col gap-3">
              <Input
                label={t('design:base.input')}
                hint={t('design:base.inputHint')}
                placeholder={t('design:base.inputPlaceholder')}
              />
              <Input
                label={t('design:base.inputError')}
                error={t('design:base.errorText')}
                defaultValue="abc"
              />
              <Select
                label={t('design:base.select')}
                options={[
                  { value: 'one', label: t('design:base.optionOne') },
                  { value: 'two', label: t('design:base.optionTwo') },
                ]}
              />
              <TextArea label={t('design:base.textarea')} rows={2} />
            </div>
          </Demo>
          <Demo title={t('design:base.combobox')}>
            <Combobox
              label={t('design:base.comboboxLabel')}
              hint={t('design:base.comboboxHint')}
              options={medicines}
              value={selectedMedicine}
              onChange={setSelectedMedicine}
              emptyText={t('design:base.comboboxEmpty')}
              placeholder={COMBO_PLACEHOLDER}
            />
            <p className="mt-3 text-sm text-body" role="status">
              {selectedMedicine
                ? t('design:base.comboboxChosen', { name: selectedMedicine.label })
                : t('design:base.comboboxNone')}
            </p>
          </Demo>
          <Demo title={t('design:base.chips')}>
            <div className="flex flex-wrap items-center gap-2">
              <Chip selected={chipSelected} onToggle={() => setChipSelected((v) => !v)}>
                {t('design:base.chipToggle')}
              </Chip>
              <Chip
                onRemove={() => toast.push({ title: t('design:base.removed') })}
                removeLabel={t('design:base.chipRemoveLabel')}
              >
                {t('design:base.chipRemovable')}
              </Chip>
              <Badge>{t('design:base.badge')}</Badge>
              {SAFETY_STATES.map((state) => (
                <StateBadge key={state} state={state} />
              ))}
            </div>
          </Demo>
          <Demo title={t('design:base.tabs')}>
            <Tabs
              label={t('design:base.tabsLabel')}
              tabs={[
                {
                  id: 'one',
                  label: t('design:base.tabOne'),
                  panel: <p className="text-base text-body">{t('design:base.tabOneBody')}</p>,
                },
                {
                  id: 'two',
                  label: t('design:base.tabTwo'),
                  panel: <p className="text-base text-body">{t('design:base.tabTwoBody')}</p>,
                },
                {
                  id: 'three',
                  label: t('design:base.tabThree'),
                  panel: <p className="text-base text-body">{t('design:base.tabThreeBody')}</p>,
                },
              ]}
            />
          </Demo>
          <Demo title={t('design:base.overlays')}>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setModalOpen(true)}>{t('design:base.openModal')}</Button>
              <Button onClick={() => setDrawerOpen(true)}>{t('design:base.openDrawer')}</Button>
              <Button onClick={() => toast.push({ title: t('design:base.toastNeutral') })}>
                {t('design:base.toastNeutralButton')}
              </Button>
              <Button
                onClick={() =>
                  toast.push({
                    kind: 'blocked',
                    title: t('design:base.toastBlocked'),
                    message: t('design:base.toastBlockedBody'),
                  })
                }
              >
                {t('design:base.toastBlockedButton')}
              </Button>
              <Tooltip content={t('design:base.tooltip')}>
                <Button variant="ghost">{t('design:base.tooltipTrigger')}</Button>
              </Tooltip>
            </div>
          </Demo>
        </div>
        <Demo title={t('design:base.banners')}>
          <div className="flex flex-col gap-2">
            <Banner>{t('design:base.bannerNeutral')}</Banner>
            <Banner kind="clear">{t('design:base.bannerClear')}</Banner>
            <Banner kind="acknowledge" title={t('design:base.bannerTitle')}>
              {t('design:base.bannerAcknowledge')}
            </Banner>
            <Banner kind="blocked">{t('design:base.bannerBlocked')}</Banner>
          </div>
        </Demo>
        <Demo title={t('design:base.table')}>
          <Table
            caption={t('design:table.caption')}
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            sort={sort}
            onSort={(key) =>
              setSort((current) =>
                current?.key === key
                  ? {
                      key,
                      direction: current.direction === 'ascending' ? 'descending' : 'ascending',
                    }
                  : { key, direction: 'ascending' },
              )
            }
            selectedId="r2"
            emptyText={t('design:table.empty')}
          />
        </Demo>
        <div className="grid gap-4 md:grid-cols-2">
          <Demo title={t('design:base.empty')}>
            <EmptyState
              icon={Inbox}
              title={t('design:base.emptyTitle')}
              description={t('design:base.emptyBody')}
              headingLevel={4}
              action={<Button variant="primary">{t('design:base.emptyAction')}</Button>}
            />
          </Demo>
          <Demo title={t('design:base.skeleton')}>
            <Skeleton label={t('design:base.skeletonLabel')} lines={4} />
          </Demo>
        </div>
        <Demo title={t('design:base.stepper')}>
          <Stepper steps={steps} currentId={stepId} label={t('design:stepper.label')} />
          <div className="mt-3 flex flex-wrap gap-2">
            {steps.map((step) => (
              <Button key={step.id} variant="ghost" onClick={() => setStepId(step.id)}>
                {step.label}
              </Button>
            ))}
          </div>
        </Demo>
        <Demo title={t('design:base.diff')}>
          <DiffViewer
            caption={t('design:diff.caption')}
            beforeLabel={t('design:diff.before')}
            afterLabel={t('design:diff.after')}
            before={diffBefore}
            after={diffAfter}
            lang="en"
          />
        </Demo>
      </Section>

      <Section id="clinical" title={t('design:clinical.title')} intro={t('design:clinical.intro')}>
        <Banner kind="acknowledge">{t('design:clinical.fakeNotice')}</Banner>
        <RecordBar
          state={recordState}
          elapsedSeconds={recordState === 'idle' ? 0 : 42}
          consent={{ audio: consent.audio, aiProcessing: consent.aiProcessing }}
          engine={FAKE_ENGINE}
          onStart={() => setRecordState('recording')}
          onPause={() => setRecordState('paused')}
          onResume={() => setRecordState('recording')}
          onStop={() => setRecordState('idle')}
        />
        <ConsentPanel
          scopes={consent}
          noticeVersion="0.0-placeholder"
          onChange={(scope, value) => setConsent((current) => ({ ...current, [scope]: value }))}
          onWithdraw={() => {
            setConsent({ audio: false, aiProcessing: false, whatsapp: false });
            setRecordState('idle');
            toast.push({ kind: 'acknowledge', title: t('design:clinical.withdrawn') });
          }}
        />
        <TranscriptPane
          segments={segments}
          onEdit={() => toast.push({ title: t('design:clinical.editStub') })}
        />
        <Demo title={t('design:clinical.facts')}>
          <div className="flex flex-wrap gap-3">
            <FactChip
              label={t('design:clinical.factType')}
              value={en('design:demo.fact.symptom')}
              lang="en"
              status="heard"
              onConfirm={() => undefined}
              onReject={() => undefined}
            />
            <FactChip
              label={t('design:clinical.factType')}
              value={en('design:demo.fact.symptom')}
              lang="en"
              status="confirmed"
            />
            <FactChip
              label={t('design:clinical.factType')}
              value={en('design:demo.fact.symptom')}
              lang="en"
              status="confirmed"
              negated
            />
            <FactChip
              label={t('design:clinical.factType')}
              value={en('design:demo.fact.symptom')}
              lang="en"
              status="heard"
              uncertain
            />
          </div>
        </Demo>
        <div className="grid gap-4 md:grid-cols-2">
          <QuestionCard
            question={en('design:demo.question.text')}
            lang="en"
            reason={en('design:demo.question.reason')}
            source={{ pathway: 'Toy pathway A (FAKE)', node: 'n1', page: '0' }}
            onAsked={() => toast.push({ kind: 'clear', title: t('design:clinical.asked') })}
            onDismiss={() => toast.push({ title: t('design:clinical.dismissed') })}
          />
          <div className="flex flex-col gap-4">
            <DiagnosisCandidate
              rank={1}
              label="Toy condition A (FAKE)"
              lang="en"
              score={0.62}
              evidenceFor={[en('design:demo.evidence.for1'), en('design:demo.evidence.for2')]}
              evidenceAgainst={[en('design:demo.evidence.against1')]}
              source={{ pathway: 'Toy pathway A (FAKE)', node: 'n3' }}
              selected={selectedCandidate === 1}
              onSelect={() => setSelectedCandidate(1)}
            />
            <DiagnosisCandidate
              rank={2}
              label="Toy condition B (FAKE)"
              lang="en"
              score={0.27}
              evidenceFor={[en('design:demo.evidence.for1')]}
              evidenceAgainst={[
                en('design:demo.evidence.against1'),
                en('design:demo.evidence.against2'),
              ]}
              source={{ pathway: 'Toy pathway B (FAKE)', node: 'n2' }}
              selected={selectedCandidate === 2}
              onSelect={() => setSelectedCandidate(2)}
            />
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <AlertCard
            severity="clear"
            title={en('design:demo.alert.clearTitle')}
            message={en('design:demo.alert.clearBody')}
            lang="en"
            source={{ ruleId: 'FAKE-T1', citation: 'FAKE_FOR_TEST' }}
          />
          <AlertCard
            severity="acknowledge"
            title={en('design:demo.alert.ackTitle')}
            message={en('design:demo.alert.ackBody')}
            lang="en"
            source={{ ruleId: 'FAKE-T2', citation: 'FAKE_FOR_TEST' }}
          />
          <AlertCard
            severity="blocked"
            title={en('design:demo.alert.blockedTitle')}
            message={en('design:demo.alert.blockedBody')}
            lang="en"
            source={{ ruleId: 'FAKE-T3', citation: 'FAKE_FOR_TEST' }}
            onOverride={() =>
              toast.push({ kind: 'acknowledge', title: t('design:clinical.overrideLogged') })
            }
          />
        </div>
        <ul className="flex flex-col gap-3" aria-label={t('design:clinical.medicines')}>
          <MedicineRow
            generic="Drug-A"
            brand="Brand-X (FAKE)"
            strength="500 mg"
            form="tablet"
            dose="1"
            frequency="BD"
            duration="3 days"
            source="FAKE_FOR_TEST"
            safety="clear"
            onEdit={() => undefined}
            onRemove={() => undefined}
          />
          <MedicineRow
            generic="Drug-B"
            strength="250 mg"
            form="capsule"
            dose="1"
            frequency="TDS"
            duration="5 days"
            source="FAKE_FOR_TEST"
            safety="acknowledge"
            onEdit={() => undefined}
            onRemove={() => undefined}
          />
          <MedicineRow
            generic="Drug-C"
            strength="5 ml"
            form="syrup"
            dose="5 ml"
            frequency="OD"
            duration="7 days"
            source="FAKE_FOR_TEST"
            safety="blocked"
            onEdit={() => undefined}
            onRemove={() => undefined}
          />
        </ul>
      </Section>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('design:modal.title')}
        description={t('design:modal.description')}
        footer={
          <>
            <Button onClick={() => setModalOpen(false)}>{t('common:action.cancel')}</Button>
            <Button variant="primary" onClick={() => setModalOpen(false)}>
              {t('common:action.confirm')}
            </Button>
          </>
        }
      >
        <Input label={t('design:modal.field')} />
      </Modal>
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={t('design:drawer.title')}
        description={t('design:drawer.description')}
      >
        <p className="text-base text-body">{t('design:drawer.body')}</p>
      </Drawer>
    </div>
  );
}
