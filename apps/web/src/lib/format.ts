const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string): Intl.NumberFormat {
  let f = moneyFormatters.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 });
    } catch {
      f = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
    }
    moneyFormatters.set(currency, f);
  }
  return f;
}

/** 4000 -> "$40.00" (minor units, 2-decimal currencies). */
export function formatMoney(minor: number | null | undefined, currency = 'USD'): string {
  if (minor === null || minor === undefined || Number.isNaN(minor)) return '—';
  return moneyFormatter(currency).format(minor / 100);
}

/** "40.5" -> 4050. Returns NaN for invalid input. */
export function toMinor(major: string | number): number {
  const n = typeof major === 'number' ? major : Number(String(major).trim());
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100);
}

/** 4050 -> "40.50" */
export function toMajor(minor: number): string {
  return (minor / 100).toFixed(2);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Parses ISO strings; date-only strings are treated as local calendar dates (no TZ shift). */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (DATE_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** "12 Oct 2026" */
export function formatDate(value: string | null | undefined): string {
  const d = parseDate(value);
  return d ? dateFmt.format(d) : '—';
}

/** "12 Oct 2026, 14:05" */
export function formatDateTime(value: string | null | undefined): string {
  const d = parseDate(value);
  return d ? dateTimeFmt.format(d) : '—';
}

export function formatTime(value: string | null | undefined): string {
  const d = parseDate(value);
  return d ? timeFmt.format(d) : '';
}

/** Today's date as YYYY-MM-DD in local time (for <input type="date" min>). */
export function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Date-only part of an ISO string, for <input type="date"> values. */
export function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

export function formatKg(kg: number): string {
  return `${Number.isInteger(kg) ? kg : kg.toFixed(1)} kg`;
}

export function humanize(value: string): string {
  const s = value.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
