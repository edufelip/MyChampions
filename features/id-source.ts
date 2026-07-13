export function generateLocalId(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now()}_${rand}`;
}
