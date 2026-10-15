// Phone-first patient lookup shared by the doctor dashboard and the patients page: type a 10-digit number and the
// match appears by itself (after a short pause); the Find button and Enter do the same. The number only ever travels
// in a POST body.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api } from './client';
import { ApiError } from './client';
import type { Patient } from './types';

export type LookupStatus = 'idle' | 'invalid' | 'searching' | 'found' | 'notFound' | 'error';

export const digitsOf = (value: string): string => value.replace(/\D/g, '');

export function usePatientLookup(api: Api) {
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<LookupStatus>('idle');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useRef(0);

  const search = useCallback(
    async (value: string) => {
      const digits = digitsOf(value);
      if (digits.length !== 10) {
        setStatus('invalid');
        setPatient(null);
        return;
      }
      const mine = ++run.current;
      setStatus('searching');
      setError(null);
      try {
        const result = await api.post<{ found: boolean; patient?: Patient }>('/patients/lookup', {
          phone: digits,
        });
        if (mine !== run.current) return;
        if (result.found && result.patient) {
          setPatient(result.patient);
          setStatus('found');
        } else {
          setPatient(null);
          setStatus('notFound');
        }
      } catch (err) {
        if (mine !== run.current) return;
        setPatient(null);
        setError(err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Unexpected error'));
        setStatus('error');
      }
    },
    [api],
  );

  // instant match: once ten digits are typed, look up after a short pause
  useEffect(() => {
    if (digitsOf(phone).length !== 10) {
      run.current += 1; // drop any answer still on its way for an older number
      setStatus((s) => (s === 'invalid' ? s : 'idle'));
      setPatient(null);
      return undefined;
    }
    const timer = window.setTimeout(() => void search(phone), 300);
    return () => window.clearTimeout(timer);
  }, [phone, search]);

  return {
    phone,
    setPhone,
    status,
    patient,
    setPatient,
    /** Show a patient that was just registered as the match. */
    found: (value: Patient) => {
      run.current += 1;
      setPatient(value);
      setStatus('found');
    },
    error,
    submit: () => search(phone),
    reset: () => {
      run.current += 1;
      setPhone('');
      setStatus('idle');
      setPatient(null);
    },
  };
}
