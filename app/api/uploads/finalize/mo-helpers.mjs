export function deriveMoType(jobOrder) {
  const normalized = String(jobOrder ?? '').trim().toUpperCase();
  if (/^MO-\S+/.test(normalized)) return 'MO';
  if (/^PM-\S+/.test(normalized)) return 'PM';
  throw new Error(`Invalid Job Order prefix: ${jobOrder}`);
}
