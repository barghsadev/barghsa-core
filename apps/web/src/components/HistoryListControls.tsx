import { FieldGroup, ListSortDropdown, TextFilter } from '@barghsa/ui';
import { HISTORY_SORT_OPTIONS, type HistoryQuery } from '@barghsa/shared/validation';
import { t } from '@barghsa/i18n/app';

export function HistoryListControls({
  value,
  onChange,
  locale,
  domain,
}: {
  value: HistoryQuery;
  onChange: (value: HistoryQuery) => void;
  locale: 'en' | 'fa';
  domain: 'saving' | 'solar' | 'consultation';
}) {
  return (
    <FieldGroup className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <TextFilter
        label={t('historySearch.label', locale)}
        placeholder={t(`historySearch.${domain}`, locale)}
        value={value.q}
        onChange={(q) => onChange({ ...value, q })}
      />
      <ListSortDropdown
        label={t('historySearch.sort', locale)}
        value={value.sort}
        onChange={(sort) => onChange({ ...value, sort: sort as HistoryQuery['sort'] })}
        options={HISTORY_SORT_OPTIONS.map((sort) => ({
          value: sort,
          label: t(sort.endsWith('asc') ? 'historySearch.oldest' : 'historySearch.newest', locale),
        }))}
      />
    </FieldGroup>
  );
}
