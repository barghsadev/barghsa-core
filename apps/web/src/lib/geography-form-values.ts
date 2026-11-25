export interface GeographyDraft {
  nameFa: string;
  nameEn: string;
  status: 'active' | 'inactive';
}

export function validGeographyName(value: string, field: 'nameFa' | 'nameEn') {
  const name = value.trim();
  return (
    name.length > 0 &&
    name.length <= 100 &&
    (field === 'nameFa' ? /^[\u0600-\u06FF\u200C\s]+$/ : /^[a-zA-Z\s]+$/).test(name)
  );
}

type CityRowIssue = 'importColumns' | 'invalidFa' | 'invalidEn' | 'importDuplicate';

export function inspectCityRows(text: string) {
  if (text.length > 41000) return null;
  const rows = text
    .split(/\r?\n/)
    .flatMap((line, index) => (line.trim() ? [{ line, number: index + 1 }] : []));
  if (!rows.length || rows.length > 200) return null;
  const names = new Set<string>();
  return rows.map(({ line, number }) => {
    const cells = line.split('\t').map((cell) => cell.trim());
    const [nameFa = '', nameEn = ''] = cells;
    let issue: CityRowIssue | null = null;
    if (cells.length !== 2) issue = 'importColumns';
    else if (!validGeographyName(nameFa, 'nameFa')) issue = 'invalidFa';
    else if (!validGeographyName(nameEn, 'nameEn')) issue = 'invalidEn';
    else if (names.has(nameEn)) issue = 'importDuplicate';
    else names.add(nameEn);
    return { number, nameFa, nameEn, issue };
  });
}

export function parseCityRows(text: string): { nameFa: string; nameEn: string }[] | null {
  const rows = inspectCityRows(text);
  if (!rows || rows.some((row) => row.issue)) return null;
  return rows.map(({ nameFa, nameEn }) => ({ nameFa, nameEn }));
}
