import { z } from "zod";

// Zod schema for an incident row parsed from CSV.
// Extend or relax fields as needed for your data source.
export const IncidentRowSchema = z.object({
  incident_id:  z.string().min(1),
  title:        z.string().min(1),
  severity:     z.enum(["Critical", "High", "Medium", "Low", "Info"]),
  status:       z.enum(["Open", "In Progress", "Resolved", "Closed"]),
  category:     z.string().optional(),
  assignee:     z.string().optional(),
  created_at:   z.string().datetime({ offset: true }).or(z.string().min(1)),
  resolved_at:  z.string().datetime({ offset: true }).optional().or(z.literal("")),
  sla_breached: z
    .union([z.boolean(), z.enum(["true", "false", "TRUE", "FALSE", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "TRUE" || v === "1"),
});

export type IncidentRow = z.infer<typeof IncidentRowSchema>;

export function validateRows(rows: unknown[]): {
  valid: IncidentRow[];
  invalid: { row: unknown; error: string }[];
} {
  const valid: IncidentRow[] = [];
  const invalid: { row: unknown; error: string }[] = [];

  for (const row of rows) {
    const result = IncidentRowSchema.safeParse(row);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({ row, error: result.error.message });
    }
  }

  return { valid, invalid };
}
