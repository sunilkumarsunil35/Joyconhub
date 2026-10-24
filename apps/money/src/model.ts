/** Pure data model for the expense tracker: no DOM, no storage, so it is easy to test. */

export type TxType = 'income' | 'expense';

export interface Transaction {
  id: string;
  type: TxType;
  /** Amount in minor units (cents/paise), always positive. Integers avoid float rounding drift. */
  amount: number;
  category: string;
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  note: string;
  /** Set when the entry was added automatically from a bank SMS. */
  source?: 'sms';
  smsId?: string;
  /** When the SMS arrived, ms since epoch (used to spot duplicate SMS). */
  smsAt?: number;
  /** Bank / UPI reference number from the SMS. */
  ref?: string;
}

export interface Totals {
  income: number;
  expense: number;
  /** income − expense */
  net: number;
  count: number;
}

export interface CategoryTotal {
  category: string;
  total: number;
  count: number;
  /** Share of all transactions of the same type in the set, 0–1. */
  share: number;
}

export interface DayRow extends Totals {
  date: string;
  /** Running net from the first day of the month up to and including this day. */
  cumulative: number;
}

export interface MonthRow extends Totals {
  /** `YYYY-MM` */
  month: string;
  /** Fraction of income kept (net / income); null when there was no income. */
  savingsRate: number | null;
}

export const DEFAULT_CATEGORIES: Record<TxType, string[]> = {
  income: ['Salary', 'Business', 'Freelance', 'Investments', 'Gifts', 'Refunds', 'Other income'],
  expense: [
    'Food & Dining',
    'Groceries',
    'Rent',
    'Bills & Utilities',
    'Transport',
    'Shopping',
    'Health',
    'Entertainment',
    'Education',
    'Travel',
    'EMI & Loans',
    'Other',
  ],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` for a Date in local time. */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Shift a `YYYY-MM` month by `delta` months. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(y, m, 0).getDate();
}

/** Parse a user-typed amount ("1,234.50", "12") into minor units; null if invalid or ≤ 0. */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(s)) return null;
  const minor = Math.round(Number(s) * 100);
  return minor > 0 ? minor : null;
}

export function totals(txs: readonly Transaction[]): Totals {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.type === 'income') income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, net: income - expense, count: txs.length };
}

export function inMonth(txs: readonly Transaction[], month: string): Transaction[] {
  return txs.filter((t) => monthOf(t.date) === month);
}

export function inYear(txs: readonly Transaction[], year: number): Transaction[] {
  const prefix = `${year}-`;
  return txs.filter((t) => t.date.startsWith(prefix));
}

/** Totals per category for one type, largest first. */
export function byCategory(txs: readonly Transaction[], type: TxType): CategoryTotal[] {
  const map = new Map<string, { total: number; count: number }>();
  let sum = 0;
  for (const t of txs) {
    if (t.type !== type) continue;
    const e = map.get(t.category) ?? { total: 0, count: 0 };
    e.total += t.amount;
    e.count += 1;
    map.set(t.category, e);
    sum += t.amount;
  }
  return [...map.entries()]
    .map(([category, e]) => ({ category, ...e, share: sum ? e.total / sum : 0 }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
}

/** One row per calendar day of `month` (including empty days), with a running net. */
export function dailyBreakdown(txs: readonly Transaction[], month: string): DayRow[] {
  const days = daysInMonth(month);
  const buckets: Transaction[][] = Array.from({ length: days }, () => []);
  for (const t of txs) {
    if (monthOf(t.date) !== month) continue;
    buckets[Number(t.date.slice(8, 10)) - 1]?.push(t);
  }
  let cumulative = 0;
  return buckets.map((b, i) => {
    const tot = totals(b);
    cumulative += tot.net;
    return { date: `${month}-${String(i + 1).padStart(2, '0')}`, ...tot, cumulative };
  });
}

/** One row per month of `year`, January to December. */
export function monthlyBreakdown(txs: readonly Transaction[], year: number): MonthRow[] {
  const buckets: Transaction[][] = Array.from({ length: 12 }, () => []);
  for (const t of inYear(txs, year)) buckets[Number(t.date.slice(5, 7)) - 1]?.push(t);
  return buckets.map((b, i) => {
    const tot = totals(b);
    return {
      month: `${year}-${String(i + 1).padStart(2, '0')}`,
      ...tot,
      savingsRate: tot.income ? tot.net / tot.income : null,
    };
  });
}

/** Newest first; ties keep the most recently added on top. */
export function sortTransactions(txs: readonly Transaction[]): Transaction[] {
  return txs
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.date.localeCompare(a.t.date) || b.i - a.i)
    .map(({ t }) => t);
}

export function isTransaction(v: unknown): v is Transaction {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    (t.type === 'income' || t.type === 'expense') &&
    typeof t.amount === 'number' &&
    Number.isInteger(t.amount) &&
    t.amount > 0 &&
    typeof t.category === 'string' &&
    typeof t.date === 'string' &&
    DATE_RE.test(t.date) &&
    typeof t.note === 'string'
  );
}

// ---- CSV ----

const CSV_HEADER = ['date', 'type', 'category', 'amount', 'note'];

function csvCell(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Oldest first, so importing the file back keeps same-day entries in their original order. */
export function toCSV(txs: readonly Transaction[]): string {
  const rows = sortTransactions(txs)
    .reverse()
    .map((t) =>
      [t.date, t.type, t.category, (t.amount / 100).toFixed(2), t.note].map(csvCell).join(','),
    );
  return [CSV_HEADER.join(','), ...rows].join('\n') + '\n';
}

function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/**
 * Parse a CSV with a `date,type,category,amount,note` header (any column order, extra columns
 * ignored). Returns the valid transactions and the 1-based line numbers that were skipped.
 */
export function fromCSV(
  text: string,
  newId: () => string,
): { transactions: Transaction[]; skipped: number[] } {
  const [header, ...rows] = parseCSVRows(text.replace(/^\uFEFF/, ''));
  const col = (name: string) => header?.findIndex((h) => h.trim().toLowerCase() === name) ?? -1;
  const idx = Object.fromEntries(CSV_HEADER.map((h) => [h, col(h)]));
  const transactions: Transaction[] = [];
  const skipped: number[] = [];
  rows.forEach((r, i) => {
    const get = (name: string) => (idx[name]! >= 0 ? (r[idx[name]!] ?? '').trim() : '');
    const type = get('type').toLowerCase();
    const t = {
      id: newId(),
      type:
        type === 'income' || type === 'credit'
          ? 'income'
          : type === 'expense' || type === 'debit'
            ? 'expense'
            : '',
      amount: parseAmount(get('amount')),
      category: get('category') || 'Other',
      date: get('date'),
      note: get('note'),
    };
    if (isTransaction(t)) transactions.push(t);
    else skipped.push(i + 2);
  });
  return { transactions, skipped };
}
