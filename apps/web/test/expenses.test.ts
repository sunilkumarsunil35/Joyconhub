import { describe, expect, it } from 'vitest';
import {
  addMonths,
  byCategory,
  dailyBreakdown,
  daysInMonth,
  fromCSV,
  monthlyBreakdown,
  parseAmount,
  sortTransactions,
  toCSV,
  totals,
  type Transaction,
} from '../src/expenses/model.ts';

let n = 0;
const id = () => `t${++n}`;
const tx = (
  p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'date'>,
): Transaction => ({
  id: id(),
  category: p.type === 'income' ? 'Salary' : 'Groceries',
  note: '',
  ...p,
});

const sample: Transaction[] = [
  tx({ type: 'income', amount: 500_000, date: '2026-10-01', category: 'Salary' }),
  tx({ type: 'expense', amount: 150_000, date: '2026-10-01', category: 'Rent' }),
  tx({ type: 'expense', amount: 2_550, date: '2026-10-03', category: 'Groceries' }),
  tx({ type: 'expense', amount: 7_450, date: '2026-10-03', category: 'Groceries' }),
  tx({ type: 'income', amount: 20_000, date: '2026-10-15', category: 'Freelance' }),
  tx({ type: 'expense', amount: 40_000, date: '2026-09-28', category: 'Travel' }),
  tx({ type: 'income', amount: 500_000, date: '2026-09-01', category: 'Salary' }),
];

describe('parseAmount', () => {
  it('parses to minor units', () => {
    expect(parseAmount('12')).toBe(1200);
    expect(parseAmount('12.5')).toBe(1250);
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount('.99')).toBe(99);
    expect(parseAmount('0.1')).toBe(10);
  });
  it('rejects invalid, zero and negative values', () => {
    for (const s of ['', 'abc', '0', '-5', '1.234', '1e3']) expect(parseAmount(s)).toBeNull();
  });
});

describe('dates', () => {
  it('shifts months across year boundaries', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-10', -22)).toBe('2024-12');
  });
  it('knows month lengths', () => {
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2026-10')).toBe(31);
  });
});

describe('totals and categories', () => {
  it('sums income, expense and net', () => {
    expect(totals(sample)).toEqual({ income: 1_020_000, expense: 200_000, net: 820_000, count: 7 });
  });
  it('groups by category, largest first, with shares', () => {
    const exp = byCategory(sample, 'expense');
    expect(exp.map((c) => [c.category, c.total, c.count])).toEqual([
      ['Rent', 150_000, 1],
      ['Travel', 40_000, 1],
      ['Groceries', 10_000, 2],
    ]);
    expect(exp[0]!.share).toBeCloseTo(0.75);
    expect(byCategory(sample, 'income').map((c) => c.category)).toEqual(['Salary', 'Freelance']);
  });
});

describe('daily breakdown', () => {
  it('has a row for every day with a running net', () => {
    const days = dailyBreakdown(sample, '2026-10');
    expect(days).toHaveLength(31);
    expect(days[0]).toMatchObject({ date: '2026-10-01', income: 500_000, expense: 150_000 });
    expect(days[2]).toMatchObject({ expense: 10_000, count: 2, cumulative: 340_000 });
    expect(days[1]).toMatchObject({ count: 0, cumulative: 350_000 });
    expect(days[30]!.cumulative).toBe(360_000);
  });
});

describe('monthly breakdown', () => {
  it('has twelve months with savings rate', () => {
    const months = monthlyBreakdown(sample, 2026);
    expect(months).toHaveLength(12);
    expect(months[8]).toMatchObject({ month: '2026-09', income: 500_000, expense: 40_000 });
    expect(months[8]!.savingsRate).toBeCloseTo(0.92);
    expect(months[0]!.savingsRate).toBeNull();
  });
});

describe('sorting', () => {
  it('orders newest date first, then latest added', () => {
    const sorted = sortTransactions(sample);
    expect(sorted[0]!.date).toBe('2026-10-15');
    expect(sorted.at(-1)!.date).toBe('2026-09-01');
    const oct3 = sorted.filter((t) => t.date === '2026-10-03');
    expect(oct3.map((t) => t.amount)).toEqual([7_450, 2_550]);
  });
});

describe('CSV', () => {
  it('round-trips, including quotes and commas in notes', () => {
    const withNote = [
      ...sample,
      tx({ type: 'expense', amount: 999, date: '2026-10-20', note: 'Tea, "chai" & snacks' }),
    ];
    const back = fromCSV(toCSV(withNote), id);
    expect(back.skipped).toEqual([]);
    const strip = (ts: Transaction[]) => sortTransactions(ts).map(({ id: _id, ...rest }) => rest);
    expect(strip(back.transactions)).toEqual(strip(withNote));
  });
  it('accepts credit/debit, any column order, and reports bad lines', () => {
    const csv =
      'Amount,Date,Type,Category\r\n10,2026-10-01,credit,Gift\r\nx,2026-10-02,debit,Food\r\n5,2026-10-02,debit,\r\n';
    const { transactions, skipped } = fromCSV(csv, id);
    expect(transactions.map((t) => [t.type, t.amount, t.category])).toEqual([
      ['income', 1000, 'Gift'],
      ['expense', 500, 'Other'],
    ]);
    expect(skipped).toEqual([3]);
  });
});
