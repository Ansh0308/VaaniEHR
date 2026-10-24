// The WhatsApp send log of a visit (Phase 10 Run 1): what was sent, when, to which number ending, and its delivery status. The
// phone number itself is never stored or shown; only its last four digits.
import { useTranslation } from 'react-i18next';
import type { WhatsAppMessage } from '../../api/whatsapp';
import { useDateText } from '../../api/useDateText';
import { Badge } from '../ui/Badge';

export function WhatsAppLog({ messages }: { messages: WhatsAppMessage[] }) {
  const { t } = useTranslation('consult');
  const dateText = useDateText();
  return (
    <section
      aria-label={t('consult:wa.logRegion')}
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <h2 className="font-display text-xl font-semibold text-ink">{t('consult:wa.logTitle')}</h2>
      {messages.length === 0 ? (
        <p className="text-sm text-body">{t('consult:wa.logEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {messages.map((m) => (
            <li key={m.id} className="rounded-md border border-line p-3 text-sm text-ink">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                <Badge>{t(`consult:wa.messageStatus.${m.status}`)}</Badge>
                {t('consult:wa.logLine', { version: m.summaryVersion, last4: m.recipientLast4 })}
              </p>
              <p>
                {dateText(m.sentAt)} · {t(`consult:wa.provider.${m.provider}`)}
              </p>
              {m.deliveredAt ? (
                <p>{t('consult:wa.deliveredAt', { time: dateText(m.deliveredAt) })}</p>
              ) : null}
              {m.errorMessage ? <p className="font-semibold">{m.errorMessage}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
