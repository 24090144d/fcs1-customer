// CSV parsing utilities — implemented in Phase 2
// Uses PapaParse for browser-side parsing and Web Workers for large files.

export type CsvParseResult<T> = {
  data: T[];
  errors: string[];
  meta: { fields: string[]; rowCount: number };
};

// parse() will be implemented in Phase 2
export async function parse<T>(_file: File): Promise<CsvParseResult<T>> {
  throw new Error("CSV parsing not yet implemented");
}
