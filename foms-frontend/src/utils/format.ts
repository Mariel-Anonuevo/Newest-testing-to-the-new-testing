/**
 * Display formatters — the only currency/date/aging/initials helpers in the app.
 * Values are formatted exactly as supplied; nothing is computed or defaulted here.
 */

const LOCALE = 'en-PH';
const CURRENCY = 'PHP';

export const NOT_AVAILABLE = 'N/A';

const isBlank = (v: unknown): v is null | undefined | '' => v === null || v === undefined || v === '';

export function formatCurrency(value: number | null | undefined): string {
  if (isBlank(value) || Number.isNaN(Number(value))) return NOT_AVAILABLE;
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, minimumFractionDigits: 2 }).format(Number(value));
}

export function formatNumber(value: number | null | undefined): string {
  if (isBlank(value) || Number.isNaN(Number(value))) return NOT_AVAILABLE;
  return new Intl.NumberFormat(LOCALE).format(Number(value));
}

export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (isBlank(value) || Number.isNaN(Number(value))) return NOT_AVAILABLE;
  return `${Number(value).toFixed(fractionDigits)}%`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (isBlank(value)) return NOT_AVAILABLE;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return NOT_AVAILABLE;
  return d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (isBlank(value)) return NOT_AVAILABLE;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return NOT_AVAILABLE;
  return d.toLocaleString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (isBlank(value)) return NOT_AVAILABLE;
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return NOT_AVAILABLE;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Display text for a days-overdue figure supplied by the API (negative = days left). */
export function formatDaysOverdue(days: number | null | undefined): string {
  if (isBlank(days)) return NOT_AVAILABLE;
  if (days === 0) return 'Due today';
  return days > 0 ? `${days} day${days === 1 ? '' : 's'} overdue` : `${Math.abs(days)} day${days === -1 ? '' : 's'} left`;
}

/** Trend display: "N/A" when the API returns null. */
export function formatTrend(value: number | null | undefined): string {
  if (isBlank(value) || Number.isNaN(Number(value))) return NOT_AVAILABLE;
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export function getInitials(fullName: string | null | undefined): string {
  if (!fullName) return '';
  return fullName.split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? '').split(/\s+/)[0] ?? '';
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseCalendarDate(val: string): CalendarDate | null {
  if (!val) return null;
  const str = val.trim();
  const matchIso = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (matchIso) {
    const year = parseInt(matchIso[1], 10);
    const month = parseInt(matchIso[2], 10);
    const day = parseInt(matchIso[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { year, month, day };
    }
  }
  const matchMonthWord = str.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})/);
  if (matchMonthWord) {
    const monthIdx = MONTH_NAMES.findIndex(m => m.toLowerCase() === matchMonthWord[1].substring(0, 3).toLowerCase());
    if (monthIdx !== -1) {
      const day = parseInt(matchMonthWord[2], 10);
      const year = parseInt(matchMonthWord[3], 10);
      return { year, month: monthIdx + 1, day };
    }
  }
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate()
  };
}

/** Formats billing period calendar dates without timezone drift, avoiding em dashes. */
export function formatBillingPeriod(start?: string | null, end?: string | null): string {
  if (!start && !end) return '-';

  let s = (start ?? '').trim();
  let e = (end ?? '').trim();

  if (!e && s) {
    if (s.includes(' - ') || s.includes(' – ') || s.includes(' to ')) {
      const sep = s.includes(' - ') ? ' - ' : s.includes(' – ') ? ' – ' : ' to ';
      const parts = s.split(sep);
      s = parts[0]?.trim() || '';
      e = parts[1]?.trim() || '';
    }
  }

  if (!s && !e) return '-';
  if (s && !e) {
    const d1 = parseCalendarDate(s);
    if (d1) return `${MONTH_NAMES[d1.month - 1]} ${d1.day}, ${d1.year}`;
    return s;
  }

  const d1 = parseCalendarDate(s);
  const d2 = parseCalendarDate(e);

  if (!d1 || !d2) {
    return s && e ? `${s} - ${e}` : (s || e || '-');
  }

  const m1 = MONTH_NAMES[d1.month - 1];
  const m2 = MONTH_NAMES[d2.month - 1];

  if (d1.year === d2.year && d1.month === d2.month) {
    return `${m1} ${d1.day} - ${d2.day}, ${d1.year}`;
  }

  return `${m1} ${d1.day}, ${d1.year} - ${m2} ${d2.day}, ${d2.year}`;
}
