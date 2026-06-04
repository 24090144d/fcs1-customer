export function deriveMoType(jobOrder) {
  const normalized = String(jobOrder ?? '').trim().toUpperCase();
  if (normalized.startsWith('MO')) return 'MO';
  if (normalized.startsWith('PM')) return 'PM';
  throw new Error(`Invalid Job Order prefix: ${jobOrder}`);
}
