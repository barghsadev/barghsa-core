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

export function parseCityRows(text: string): { nameFa: string; nameEn: string }[] | null {
  if (text.length > 41000) return null;
  const rows = text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!rows.length || rows.length > 200) return null;
  const cities: { nameFa: string; nameEn: string }[] = [];
  for (const row of rows) {
    const cells = row.split('\t').map((cell) => cell.trim());
    if (
      cells.length !== 2 ||
      !validGeographyName(cells[0]!, 'nameFa') ||
      !validGeographyName(cells[1]!, 'nameEn')
    )
      return null;
    cities.push({ nameFa: cells[0]!, nameEn: cells[1]! });
  }
  return cities;
}
