// "Load template": shows the lines of a template as the later prescription builder will receive them.
// A medicine that was retired after it was added is flagged on its line. It is never dropped or swapped for another.
// Nothing is prescribed here (nothing is final before the doctor signs off).
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import { errorText } from '../../api/errorText';
import { pageLabel } from '../../api/medicines';
import type { LoadedTemplate } from '../../api/templates';
import { useRequest } from '../../api/useRequest';
import { useAuth } from '../../auth/AuthContext';
import { Badge } from '../ui/Badge';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Feedback';
import { Modal } from '../ui/Overlay';
import { medicineText } from './MedicineCombobox';

function Body({ templateId }: { templateId: string }) {
  const { t } = useTranslation('templates');
  const { api } = useAuth();
  const loaded = useRequest(
    () => api.get<LoadedTemplate>(`/templates/${templateId}/load`),
    [api, templateId],
  );

  if (loaded.state.status === 'loading')
    return <Skeleton lines={3} label={t('templates:list.loading')} />;
  if (loaded.state.status === 'error') {
    const retired = loaded.state.error instanceof ApiError && loaded.state.error.status === 409;
    return (
      <Banner kind="blocked" live>
        {retired ? t('templates:load.retiredTemplate') : errorText(t, loaded.state.error)}
      </Banner>
    );
  }
  const data = loaded.state.data;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-body">{t('templates:load.description')}</p>
      {data.hasRetiredMedicine ? (
        <Banner kind="acknowledge" live>
          {t('templates:load.summaryRetired')}
        </Banner>
      ) : null}
      {data.items.length === 0 ? (
        <p className="text-base text-body">{t('templates:load.empty')}</p>
      ) : (
        <ol aria-label={data.template.name} className="flex flex-col gap-3">
          {data.items.map((item) => {
            const page = pageLabel(item.medicine.sourcePage, item.medicine.sourcePagePrinted, t);
            return (
              <li
                key={item.position}
                className="flex flex-col gap-1 rounded-md border border-control bg-card p-3"
              >
                <p className="text-base font-semibold text-ink">
                  {item.position + 1}. {medicineText(item.medicine)}
                </p>
                <p className="text-sm text-body">
                  {[
                    item.dose,
                    item.frequency ? t(`templates:frequency.${item.frequency}`) : null,
                    item.duration,
                  ]
                    .filter(Boolean)
                    .join(' · ') || t('templates:preview.notSet')}
                </p>
                {item.instructions ? <p className="text-sm text-ink">{item.instructions}</p> : null}
                <p className="flex flex-wrap items-center gap-2 text-xs text-body">
                  {item.medicine.reviewStatus === 'not_reviewed' ? (
                    <Badge className="border-dashed">{t('medicines:status.notReviewed')}</Badge>
                  ) : null}
                  {page ? <span>{page}</span> : null}
                </p>
                {item.problem === 'MEDICINE_RETIRED' ? (
                  <p className="flex items-start gap-2 text-sm font-semibold text-ink">
                    <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                    {t('templates:load.retiredWarning', { name: item.medicine.genericName })}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function TemplateLoadDialog({
  templateId,
  name,
  onClose,
}: {
  /** null: closed. */
  templateId: string | null;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('templates');
  return (
    <Modal
      open={templateId !== null}
      onClose={onClose}
      title={t('templates:load.title', { name })}
      footer={<Button onClick={onClose}>{t('templates:load.close')}</Button>}
    >
      {templateId ? <Body templateId={templateId} /> : null}
    </Modal>
  );
}
