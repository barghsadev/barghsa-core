/** Shared table copy. Callers supply translated column headers and cell content. */
export const dataTableLabels = {
  en: {
    loading: 'Loading...',
    empty: 'No results',
    selectAll: 'Select all rows',
    deselectAll: 'Deselect all rows',
    selectRow: (number: string) => `Select row ${number}`,
  },
  fa: {
    loading: 'در حال بارگذاری...',
    empty: 'نتیجه‌ای یافت نشد',
    selectAll: 'انتخاب همه ردیف‌ها',
    deselectAll: 'لغو انتخاب همه ردیف‌ها',
    selectRow: (number: string) => `انتخاب ردیف ${number}`,
  },
} as const;
