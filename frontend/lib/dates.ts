import dayjs from 'dayjs';

/** `YYYY-MM-DD` of the day after `date` (empty stays empty). Used for exclusive `to` bounds. */
export function nextDay(date: string): string {
  if (!date) return '';
  const d = dayjs(date);
  return d.isValid() ? d.add(1, 'day').format('YYYY-MM-DD') : '';
}

/** Today as `YYYY-MM-DD` (local time). */
export function today(): string {
  return dayjs().format('YYYY-MM-DD');
}

/** Converts a `YYYY-MM-DD` (or empty) to an RFC3339 timestamp at local midnight, or null. */
export function dateToRfc3339(date: string): string | null {
  if (!date) return null;
  const d = dayjs(date);
  return d.isValid() ? d.startOf('day').toISOString() : null;
}

/** Converts a `datetime-local` value to RFC3339, or null. */
export function localDateTimeToRfc3339(value: string): string | null {
  if (!value) return null;
  const d = dayjs(value);
  return d.isValid() ? d.toISOString() : null;
}

/** Current Buddhist-era year. */
export function currentBEYear(): number {
  return dayjs().year() + 543;
}
