/**
 * Formats a meal item's quantity for display.
 *
 * The nutrition "Amount(g)" input only accepts digits/decimal points (see
 * AddItemForm), so a bare numeric quantity like "150" is a gram amount and
 * gets a "g" suffix appended. Other quantity values already carry their own
 * unit or descriptive text — e.g. starter-template/assigned items such as
 * "1 bowl" or "1 medium", or custom-meal snapshots that already format as
 * "350g" — and must be rendered as-is. Blindly appending "g" to those
 * produced malformed strings like "1 bowlg" (ET-166).
 */
export function formatQuantityWithUnit(quantity: string): string {
  const trimmed = quantity.trim();
  if (trimmed === '') return '';
  return /^\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}g` : trimmed;
}
