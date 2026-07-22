export type CsvValue = string | number | null | undefined;

export function downloadCsvFile(filename: string, headers: string[], rows: CsvValue[][]): void {
  const cell = (value: CsvValue) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const content = [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function csvSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'all';
}
