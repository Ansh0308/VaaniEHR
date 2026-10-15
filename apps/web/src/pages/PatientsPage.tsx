// PG-03 Patient lookup / register (staff, admin). Phone first, like ClinicOS: type the number, the match appears,
// otherwise quick-create in a dialog. Allergy chips are prominent and editable here (doctors only read them).
import { Plus, Save, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { errorText } from '../api/errorText';
import type { Patient } from '../api/types';
import { digitsOf, usePatientLookup } from '../api/usePatientLookup';
import { useAuth } from '../auth/AuthContext';
import { PatientCard } from '../components/clinical/PatientCard';
import { PhoneSearch } from '../components/clinical/PhoneSearch';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { ErrorSummary, type FormError } from '../components/ui/ErrorSummary';
import { Input, Select } from '../components/ui/Field';
import { Modal } from '../components/ui/Overlay';
import { Switch } from '../components/ui/Switch';
import { useToast } from '../components/ui/Toast';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ALLERGIES = 50;
const MAX_ALLERGY_LENGTH = 200;

function RegisterDialog({
  open,
  phone,
  onClose,
  onCreated,
}: {
  open: boolean;
  phone: string;
  onClose: () => void;
  onCreated: (patient: Patient) => void;
}) {
  const { t } = useTranslation('patients');
  const { api } = useAuth();
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [optIn, setOptIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ dob?: string; form?: string }>({});
  const summaryRef = useRef<HTMLDivElement>(null);
  const [attempts, setAttempts] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (attempts > 0) summaryRef.current?.focus();
  }, [attempts]);

  const summary: FormError[] = [
    ...(errors.dob ? [{ fieldId: 'register-dob', message: errors.dob }] : []),
    ...(errors.form ? [{ message: errors.form }] : []),
  ];

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: { dob?: string; form?: string } = {};
    if (dob && Date.parse(dob) > Date.now()) next.dob = t('patients:register.dobFuture');
    setErrors(next);
    if (next.dob) {
      setAttempts((n) => n + 1);
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ created: boolean; patient: Patient }>('/patients', {
        phone: digitsOf(phone),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(dob ? { dob } : {}),
        ...(gender ? { gender } : {}),
        optInMsg: optIn,
      });
      onCreated(result.patient);
    } catch (err) {
      setErrors({ form: errorText(t, err) });
      setAttempts((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('patients:register.title')}
      description={t('patients:register.description')}
      initialFocusRef={nameRef}
      footer={
        <>
          <Button onClick={onClose}>{t('common:action.cancel')}</Button>
          <Button
            variant="primary"
            icon={UserPlus}
            type="submit"
            form="register-form"
            loading={busy}
          >
            {t('patients:register.submit')}
          </Button>
        </>
      }
    >
      <form id="register-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <ErrorSummary
          ref={summaryRef}
          title={t('patients:register.errorSummary')}
          errors={summary}
        />
        <Input label={t('patients:register.phone')} value={phone} readOnly />
        <Input
          ref={nameRef}
          label={t('patients:register.name')}
          maxLength={200}
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          id="register-dob"
          label={t('patients:register.dob')}
          hint={t('patients:register.dobHint')}
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          {...(errors.dob ? { error: errors.dob } : {})}
        />
        <Select
          label={t('patients:register.gender')}
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          options={[
            { value: '', label: t('patients:register.genderUnknown') },
            { value: 'male', label: t('patients:register.genderMale') },
            { value: 'female', label: t('patients:register.genderFemale') },
            { value: 'other', label: t('patients:register.genderOther') },
          ]}
        />
        <Switch
          label={t('patients:register.optIn')}
          description={t('patients:register.optInHint')}
          checked={optIn}
          onChange={setOptIn}
          onText={t('common:state.on')}
          offText={t('common:state.off')}
        />
      </form>
    </Modal>
  );
}

export function PatientsPage() {
  const { t } = useTranslation('patients');
  const { api } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const lookup = usePatientLookup(api);
  const phoneRef = useRef<HTMLInputElement>(null);

  const [allergies, setAllergies] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [newAllergy, setNewAllergy] = useState('');
  const [allergyError, setAllergyError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();

  // a new match resets the editable allergy list
  useEffect(() => {
    const list = lookup.patient?.allergies ?? [];
    setAllergies(list);
    setSaved(list);
    setNewAllergy('');
    setAllergyError(undefined);
  }, [lookup.patient]);

  const dirty = JSON.stringify(allergies) !== JSON.stringify(saved);

  function addAllergy(event?: FormEvent) {
    event?.preventDefault();
    const value = newAllergy.trim();
    if (value === '') return;
    if (value.length > MAX_ALLERGY_LENGTH) {
      setAllergyError(t('patients:allergies.tooLong', { max: MAX_ALLERGY_LENGTH }));
      return;
    }
    if (allergies.length >= MAX_ALLERGIES) {
      setAllergyError(t('patients:allergies.tooMany', { max: MAX_ALLERGIES }));
      return;
    }
    if (allergies.some((a) => a.toLowerCase() === value.toLowerCase())) {
      setAllergyError(t('patients:allergies.duplicate'));
      return;
    }
    setAllergies([...allergies, value]);
    setNewAllergy('');
    setAllergyError(undefined);
  }

  async function saveAllergies() {
    if (!lookup.patient) return;
    setSaving(true);
    try {
      const result = await api.put<{ allergies: string[] }>(
        `/patients/${lookup.patient.id}/clinical-profile`,
        { allergies },
      );
      setAllergies(result.allergies);
      setSaved(result.allergies);
      lookup.setPatient({ ...lookup.patient, allergies: result.allergies });
      toast.push({ kind: 'clear', title: t('patients:allergies.saved') });
    } catch (err) {
      toast.push({
        kind: 'blocked',
        title: t('patients:allergies.saveFailed'),
        message: errorText(t, err),
      });
    } finally {
      setSaving(false);
    }
  }

  function openConsent(event: FormEvent) {
    event.preventDefault();
    const value = code.trim();
    if (!UUID.test(value)) {
      setCodeError(t('patients:session.invalid'));
      return;
    }
    navigate(`/consult/${value}/consent`);
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header>
        <h1 className="font-display text-3xl font-semibold text-ink">{t('patients:title')}</h1>
        <p className="mt-1 text-base text-body">{t('patients:intro')}</p>
      </header>

      <section aria-labelledby="find-heading" className="flex flex-col gap-3">
        <h2 id="find-heading" className="text-2xl font-semibold text-ink">
          {t('patients:lookup.heading')}
        </h2>
        <PhoneSearch
          ref={phoneRef}
          phone={lookup.phone}
          onPhone={lookup.setPhone}
          status={lookup.status}
          error={lookup.error}
          onSubmit={() => void lookup.submit()}
        />

        {lookup.status === 'notFound' ? (
          <Banner
            kind="acknowledge"
            live
            title={t('patients:lookup.notFoundTitle')}
            actions={
              <Button variant="primary" icon={UserPlus} onClick={() => setRegisterOpen(true)}>
                {t('patients:register.open')}
              </Button>
            }
          >
            {t('patients:lookup.notFoundBody')}
          </Banner>
        ) : null}

        {lookup.patient ? (
          <PatientCard
            patient={{ ...lookup.patient, allergies }}
            onRemoveAllergy={(index) => setAllergies(allergies.filter((_, i) => i !== index))}
          >
            <form onSubmit={addAllergy} className="flex flex-col gap-3" noValidate>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-60 flex-1">
                  <Input
                    label={t('patients:allergies.addLabel')}
                    hint={t('patients:allergies.addHint')}
                    value={newAllergy}
                    maxLength={MAX_ALLERGY_LENGTH + 20}
                    autoComplete="off"
                    onChange={(e) => {
                      setNewAllergy(e.target.value);
                      setAllergyError(undefined);
                    }}
                    {...(allergyError ? { error: allergyError } : {})}
                  />
                </div>
                <Button type="submit" icon={Plus}>
                  {t('patients:allergies.add')}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  icon={Save}
                  disabled={!dirty}
                  loading={saving}
                  onClick={() => void saveAllergies()}
                >
                  {t('patients:allergies.save')}
                </Button>
                <p role="status" className="text-sm text-body">
                  {dirty ? t('patients:allergies.unsaved') : ''}
                </p>
              </div>
            </form>
          </PatientCard>
        ) : null}
      </section>

      <section aria-labelledby="session-heading" className="flex flex-col gap-3">
        <h2 id="session-heading" className="text-2xl font-semibold text-ink">
          {t('patients:session.heading')}
        </h2>
        <p className="text-sm text-body">{t('patients:session.intro')}</p>
        <form onSubmit={openConsent} noValidate className="flex flex-wrap items-end gap-3">
          <div className="min-w-60 flex-1">
            <Input
              label={t('patients:session.label')}
              hint={t('patients:session.hint')}
              autoComplete="off"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setCodeError(undefined);
              }}
              {...(codeError ? { error: codeError } : {})}
            />
          </div>
          <Button type="submit">{t('patients:session.open')}</Button>
        </form>
      </section>

      <RegisterDialog
        open={registerOpen}
        phone={lookup.phone}
        onClose={() => {
          setRegisterOpen(false);
          phoneRef.current?.focus();
        }}
        onCreated={(patient) => {
          setRegisterOpen(false);
          lookup.found(patient);
          toast.push({ kind: 'clear', title: t('patients:register.done') });
        }}
      />
    </div>
  );
}
