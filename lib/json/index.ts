// JSON transform utilities — implemented in Phase 2
// Converts Supabase rows into dashboard-ready JSON shapes.

export type JsonExportOptions = {
  pretty?: boolean;
};

// toJson() will be implemented in Phase 2
export function toJson<T>(_data: T[], _options?: JsonExportOptions): string {
  throw new Error("JSON export not yet implemented");
}
