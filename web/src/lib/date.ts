// Deterministic UTC date formatting (avoids relying on Intl/ICU locale data in workerd).

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Format a timestamp as e.g. "June 26, 2026". Returns "" for null/undefined. */
export function formatDate(value: Date | number | null | undefined): string {
  if (value == null) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
