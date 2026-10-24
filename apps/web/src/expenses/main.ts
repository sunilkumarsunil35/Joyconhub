import '../shared/theme.css';
import './expenses.css';
import { escapeHtml, readJSON, writeJSON } from '../shared/storage.ts';
import {
  DEFAULT_CATEGORIES,
  addMonths,
  byCategory,
  dailyBreakdown,
  fromCSV,
  inMonth,
  inYear,
  isTransaction,
  monthOf,
  monthlyBreakdown,
  parseAmount,
  sortTransactions,
  toCSV,
  toISODate,
  totals,
  type Transaction,
  type TxType,
} from './model.ts';

type Tab = 'daily' | 'monthly' | 'categories' | 'transactions';
type Scope = 'month' | 'year' | 'all';

interface Saved {
  transactions: Transaction[];
  currency: string;
}

interface Prefs {
  tab: Tab;
  scope: Scope;
  showEmptyDays: boolean;
}

const DATA_KEY = 'joyconhub.expenses.v1';
const PREFS_KEY = 'joyconhub.expenses.prefs';
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'CAD', 'AUD', 'SGD', 'JPY'];
const EURO_REGIONS = ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'IE', 'PT', 'FI', 'GR'];

function guessCurrency(): string {
  const region = navigator.language.split('-')[1]?.toUpperCase() ?? '';
  const byRegion: Record<string, string> = {
    IN: 'INR',
    US: 'USD',
    GB: 'GBP',
    AE: 'AED',
    SA: 'SAR',
    CA: 'CAD',
    AU: 'AUD',
    SG: 'SGD',
    JP: 'JPY',
  };
  return byRegion[region] ?? (EURO_REGIONS.includes(region) ? 'EUR' : 'USD');
}

const saved = readJSON<Saved>('local', DATA_KEY, { transactions: [], currency: guessCurrency() });
const state = {
  transactions: (Array.isArray(saved.transactions) ? saved.transactions : []).filter(isTransaction),
  currency: CURRENCIES.includes(saved.currency) ? saved.currency : guessCurrency(),
  ...readJSON<Prefs>('local', PREFS_KEY, { tab: 'daily', scope: 'month', showEmptyDays: false }),
  month: monthOf(toISODate(new Date())),
  year: new Date().getFullYear(),
  formType: 'expense' as TxType,
  editingId: null as string | null,
  filter: { type: 'all' as TxType | 'all', category: '', day: '', search: '' },
};

function persist(): void {
  writeJSON('local', DATA_KEY, { transactions: state.transactions, currency: state.currency });
}

function persistPrefs(): void {
  const { tab, scope, showEmptyDays } = state;
  writeJSON('local', PREFS_KEY, { tab, scope, showEmptyDays });
}

function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// ---- formatting ----

let moneyFmt: Intl.NumberFormat;
function setCurrency(code: string): void {
  state.currency = code;
  moneyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: code });
}
setCurrency(state.currency);

const money = (minor: number) => moneyFmt.format(minor / 100);
const signed = (minor: number) => (minor > 0 ? '+' : '') + money(minor);
const netClass = (minor: number) => (minor > 0 ? 'pos' : minor < 0 ? 'neg' : '');

function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d ?? 1);
}
const monthLabel = (month: string, style: 'long' | 'short' = 'long') =>
  parseDate(`${month}-01`).toLocaleDateString(undefined, { month: style, year: 'numeric' });
const dayLabel = (date: string) =>
  parseDate(date).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

function categoriesFor(type: TxType): string[] {
  const used = state.transactions.filter((t) => t.type === type).map((t) => t.category);
  return [...new Set([...DEFAULT_CATEGORIES[type], ...used])];
}

// ---- layout ----

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="money">
    <header class="topbar">
      <span class="logo"><span class="coin">₹$</span>Money <b>Tracker</b></span>
      <div class="top-actions">
        <label class="currency">Currency
          <select id="currency">${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select>
        </label>
        <button class="ghost" id="export-csv" title="Download all transactions as CSV">Export CSV</button>
        <button class="ghost" id="export-json" title="Download a full backup">Backup</button>
        <button class="ghost" id="import" title="Import a CSV or a backup file">Import</button>
        <input type="file" id="import-file" accept=".csv,.json,text/csv,application/json" hidden />
        <a class="ghost" href="./">← Hub</a>
      </div>
    </header>

    <nav class="month-nav" aria-label="Month">
      <button class="icon-btn" id="prev-month" aria-label="Previous month">‹</button>
      <h1 id="month-title"></h1>
      <button class="icon-btn" id="next-month" aria-label="Next month">›</button>
      <button class="ghost small" id="this-month">This month</button>
    </nav>

    <section class="summary" id="summary"></section>

    <div class="layout">
      <aside class="panel form-panel">
        <h2 id="form-title">Add transaction</h2>
        <form id="tx-form" autocomplete="off">
          <div class="segmented" role="radiogroup" aria-label="Type">
            <button type="button" data-type="expense" role="radio">− Expense</button>
            <button type="button" data-type="income" role="radio">+ Income</button>
          </div>
          <label>Amount<input id="f-amount" inputmode="decimal" placeholder="0.00" required /></label>
          <label>Category<input id="f-category" list="category-list" placeholder="Pick or type a new one" required /></label>
          <datalist id="category-list"></datalist>
          <div class="chips" id="category-chips"></div>
          <label>Date<input id="f-date" type="date" required /></label>
          <label><span>Note <span class="opt">(optional)</span></span><input id="f-note" maxlength="120" placeholder="e.g. Dinner with friends" /></label>
          <p class="form-error" id="form-error" role="alert"></p>
          <div class="form-actions">
            <button type="submit" class="primary" id="f-submit">Add expense</button>
            <button type="button" class="ghost" id="f-cancel" hidden>Cancel</button>
          </div>
        </form>
      </aside>

      <main class="panel views">
        <div class="tabs" role="tablist">
          <button role="tab" data-tab="daily">Daily</button>
          <button role="tab" data-tab="monthly">Monthly</button>
          <button role="tab" data-tab="categories">Categories</button>
          <button role="tab" data-tab="transactions">Transactions</button>
        </div>
        <div id="view"></div>
      </main>
    </div>
    <footer>Your data is stored only in this browser. Use Backup to keep a copy or move it to another device.</footer>
  </div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = {
  el: $<HTMLFormElement>('tx-form'),
  amount: $<HTMLInputElement>('f-amount'),
  category: $<HTMLInputElement>('f-category'),
  date: $<HTMLInputElement>('f-date'),
  note: $<HTMLInputElement>('f-note'),
  error: $('form-error'),
  submit: $<HTMLButtonElement>('f-submit'),
  cancel: $<HTMLButtonElement>('f-cancel'),
};
const view = $('view');

// ---- rendering ----

function render(): void {
  $('month-title').textContent = monthLabel(state.month);
  renderSummary();
  renderView();
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
  });
}

function renderSummary(): void {
  const m = totals(inMonth(state.transactions, state.month));
  const all = totals(state.transactions);
  const today = toISODate(new Date());
  const t = totals(state.transactions.filter((x) => x.date === today));
  $('summary').innerHTML = `
    <div class="stat income"><span>Income</span><strong>${money(m.income)}</strong><small>${monthLabel(state.month, 'short')}</small></div>
    <div class="stat expense"><span>Expenses</span><strong>${money(m.expense)}</strong><small>${monthLabel(state.month, 'short')}</small></div>
    <div class="stat net ${netClass(m.net)}"><span>Net this month</span><strong>${signed(m.net)}</strong><small>${m.income ? `${Math.round((m.net / m.income) * 100)}% saved` : `${m.count} transactions`}</small></div>
    <div class="stat today"><span>Today</span><strong>${money(t.expense)}</strong><small>spent · ${money(t.income)} received</small></div>
    <div class="stat balance ${netClass(all.net)}"><span>Overall balance</span><strong>${signed(all.net)}</strong><small>all time</small></div>`;
}

function renderView(): void {
  if (state.tab === 'daily') view.innerHTML = dailyView();
  else if (state.tab === 'monthly') view.innerHTML = monthlyView();
  else if (state.tab === 'categories') view.innerHTML = categoriesView();
  else {
    view.innerHTML = transactionsView();
    renderTxList();
  }
}

/** Grouped bar chart: green income bar and red expense bar per slot. */
function barChart(
  slots: { label: string; title: string; income: number; expense: number; key: string }[],
  attr: string,
): string {
  const max = Math.max(1, ...slots.flatMap((s) => [s.income, s.expense]));
  const W = 1000;
  const H = 180;
  const slot = W / slots.length;
  const bar = Math.max(2, Math.min(18, slot * 0.36));
  const labelEvery = slots.length > 16 ? 5 : 1;
  const bars = slots
    .map((s, i) => {
      const x = i * slot + slot / 2;
      const hi = (s.income / max) * (H - 10);
      const he = (s.expense / max) * (H - 10);
      const label =
        i % labelEvery === 0 || i === slots.length - 1
          ? `<text x="${x}" y="${H + 22}" text-anchor="middle">${s.label}</text>`
          : '';
      return `<g class="slot" ${attr}="${s.key}">
        <title>${escapeHtml(s.title)}\nIncome: ${money(s.income)}\nExpenses: ${money(s.expense)}</title>
        <rect class="hit" x="${i * slot}" y="0" width="${slot}" height="${H}" />
        ${s.income ? `<rect class="bar-in" x="${x - bar - 1}" y="${H - hi}" width="${bar}" height="${hi}" rx="3" />` : ''}
        ${s.expense ? `<rect class="bar-out" x="${x + 1}" y="${H - he}" width="${bar}" height="${he}" rx="3" />` : ''}
        ${label}
      </g>`;
    })
    .join('');
  return `<div class="chart">
    <div class="legend"><span class="key in"></span>Income<span class="key out"></span>Expenses<span class="max">Peak ${money(max)}</span></div>
    <svg viewBox="0 0 ${W} ${H + 30}" preserveAspectRatio="none" role="img" aria-label="Income and expenses chart">
      <line class="axis" x1="0" x2="${W}" y1="${H}" y2="${H}" />${bars}
    </svg></div>`;
}

const empty = (msg: string) => `<div class="empty">${msg}</div>`;

function dailyView(): string {
  const days = dailyBreakdown(state.transactions, state.month);
  const today = toISODate(new Date());
  const active = days.filter((d) => d.count);
  const tot = totals(inMonth(state.transactions, state.month));
  const top = active.reduce<(typeof days)[number] | undefined>(
    (a, b) => (!a || b.expense > a.expense ? b : a),
    undefined,
  );
  const spendDays = days.filter((d) => d.date <= today || monthOf(today) !== state.month).length;
  const rows = (state.showEmptyDays ? days : active)
    .map(
      (
        d,
      ) => `<tr data-day="${d.date}" class="${d.date === today ? 'is-today' : ''} ${d.count ? 'clickable' : 'muted'}">
        <td>${dayLabel(d.date)}</td>
        <td class="num pos">${d.income ? money(d.income) : '–'}</td>
        <td class="num neg">${d.expense ? money(d.expense) : '–'}</td>
        <td class="num ${netClass(d.net)}">${d.count ? signed(d.net) : '–'}</td>
        <td class="num ${netClass(d.cumulative)}">${signed(d.cumulative)}</td>
        <td class="num dim">${d.count || ''}</td>
      </tr>`,
    )
    .reverse()
    .join('');
  return `
    <div class="view-head">
      <h2>Daily tracker · ${monthLabel(state.month)}</h2>
      <label class="check"><input type="checkbox" id="show-empty" ${state.showEmptyDays ? 'checked' : ''}/> Show days with no entries</label>
    </div>
    ${barChart(
      days.map((d) => ({
        key: d.date,
        label: String(Number(d.date.slice(8))),
        title: dayLabel(d.date),
        income: d.income,
        expense: d.expense,
      })),
      'data-day',
    )}
    <div class="mini-stats">
      <span>Average spend / day <b>${money(Math.round(tot.expense / Math.max(1, spendDays)))}</b></span>
      <span>Highest spend day <b>${top?.expense ? `${dayLabel(top.date)} · ${money(top.expense)}` : '–'}</b></span>
      <span>Days with entries <b>${active.length} / ${days.length}</b></span>
    </div>
    ${
      rows
        ? `<div class="table-wrap"><table>
        <thead><tr><th>Day</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net</th><th class="num">Month to date</th><th class="num">#</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Total</td><td class="num pos">${money(tot.income)}</td><td class="num neg">${money(tot.expense)}</td><td class="num ${netClass(tot.net)}">${signed(tot.net)}</td><td></td><td class="num dim">${tot.count}</td></tr></tfoot>
      </table></div>`
        : empty('No entries this month yet. Add your first income or expense on the left.')
    }`;
}

function monthlyView(): string {
  const months = monthlyBreakdown(state.transactions, state.year);
  const tot = totals(inYear(state.transactions, state.year));
  const active = months.filter((m) => m.count);
  const rows = months
    .map(
      (
        m,
      ) => `<tr data-month="${m.month}" class="clickable ${m.month === state.month ? 'is-today' : ''} ${m.count ? '' : 'muted'}">
        <td>${parseDate(`${m.month}-01`).toLocaleDateString(undefined, { month: 'long' })}</td>
        <td class="num pos">${m.income ? money(m.income) : '–'}</td>
        <td class="num neg">${m.expense ? money(m.expense) : '–'}</td>
        <td class="num ${netClass(m.net)}">${m.count ? signed(m.net) : '–'}</td>
        <td class="num">${m.savingsRate === null ? '–' : `${Math.round(m.savingsRate * 100)}%`}</td>
        <td class="num dim">${m.count || ''}</td>
      </tr>`,
    )
    .join('');
  return `
    <div class="view-head">
      <h2>Monthly tracker</h2>
      <div class="year-nav">
        <button class="icon-btn" id="prev-year" aria-label="Previous year">‹</button>
        <b>${state.year}</b>
        <button class="icon-btn" id="next-year" aria-label="Next year">›</button>
      </div>
    </div>
    ${barChart(
      months.map((m) => ({
        key: m.month,
        label: parseDate(`${m.month}-01`).toLocaleDateString(undefined, { month: 'short' }),
        title: monthLabel(m.month),
        income: m.income,
        expense: m.expense,
      })),
      'data-month',
    )}
    <div class="mini-stats">
      <span>Average spend / month <b>${money(Math.round(tot.expense / Math.max(1, active.length)))}</b></span>
      <span>Saved in ${state.year} <b class="${netClass(tot.net)}">${signed(tot.net)}</b></span>
      <span>Savings rate <b>${tot.income ? `${Math.round((tot.net / tot.income) * 100)}%` : '–'}</b></span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Month</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net</th><th class="num">Saved</th><th class="num">#</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>${state.year} total</td><td class="num pos">${money(tot.income)}</td><td class="num neg">${money(tot.expense)}</td><td class="num ${netClass(tot.net)}">${signed(tot.net)}</td><td class="num">${tot.income ? `${Math.round((tot.net / tot.income) * 100)}%` : '–'}</td><td class="num dim">${tot.count}</td></tr></tfoot>
    </table></div>
    <p class="hint">Click a month to open its daily tracker.</p>`;
}

function scopedTransactions(): Transaction[] {
  if (state.scope === 'month') return inMonth(state.transactions, state.month);
  if (state.scope === 'year') return inYear(state.transactions, Number(state.month.slice(0, 4)));
  return state.transactions;
}

const scopeName = () =>
  ({ month: monthLabel(state.month), year: state.month.slice(0, 4), all: 'All time' })[state.scope];

const scopeControl = () => `
  <div class="segmented small" id="scope">
    <button data-scope="month" aria-pressed="${state.scope === 'month'}">Month</button>
    <button data-scope="year" aria-pressed="${state.scope === 'year'}">Year</button>
    <button data-scope="all" aria-pressed="${state.scope === 'all'}">All time</button>
  </div>`;

function categoriesView(): string {
  const txs = scopedTransactions();
  const block = (type: TxType) => {
    const cats = byCategory(txs, type);
    const sum = cats.reduce((a, c) => a + c.total, 0);
    return `<div class="cat-block ${type}">
      <h3>${type === 'expense' ? 'Spending' : 'Income'} by category <span>${money(sum)}</span></h3>
      ${
        cats.length
          ? `<ul class="cat-list">${cats
              .map(
                (
                  c,
                ) => `<li data-category="${escapeHtml(c.category)}" data-cat-type="${type}" title="Show these transactions">
                <div class="cat-row"><span class="cat-name">${escapeHtml(c.category)}</span><span class="cat-amt">${money(c.total)}</span></div>
                <div class="cat-bar"><i style="width:${(c.share * 100).toFixed(1)}%"></i></div>
                <div class="cat-meta">${(c.share * 100).toFixed(1)}% · ${c.count} ${c.count === 1 ? 'entry' : 'entries'}</div>
              </li>`,
              )
              .join('')}</ul>`
          : empty(`No ${type === 'expense' ? 'expenses' : 'income'} in this period.`)
      }
    </div>`;
  };
  return `
    <div class="view-head">
      <h2>Categories · ${scopeName()}</h2>
      ${scopeControl()}
    </div>
    <div class="cat-grid">${block('expense')}${block('income')}</div>`;
}

function transactionsView(): string {
  const f = state.filter;
  const cats = [...new Set([...categoriesFor('expense'), ...categoriesFor('income')])].sort();
  return `
    <div class="view-head">
      <h2>Transactions · ${f.day ? dayLabel(f.day) : scopeName()}</h2>
      ${f.day ? '' : scopeControl()}
    </div>
    <div class="filters">
      <select id="flt-type" aria-label="Type">
        <option value="all">All types</option>
        <option value="expense" ${f.type === 'expense' ? 'selected' : ''}>Expenses</option>
        <option value="income" ${f.type === 'income' ? 'selected' : ''}>Income</option>
      </select>
      <select id="flt-category" aria-label="Category">
        <option value="">All categories</option>
        ${cats.map((c) => `<option ${c === f.category ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
      </select>
      <input id="flt-search" type="search" placeholder="Search notes…" value="${escapeHtml(f.search)}" />
      ${f.day ? `<button class="chip active" id="clear-day">${dayLabel(f.day)} ✕</button>` : ''}
    </div>
    <div id="tx-list"></div>`;
}

function filteredTransactions(): Transaction[] {
  const f = state.filter;
  const q = f.search.trim().toLowerCase();
  const base = f.day ? inMonth(state.transactions, monthOf(f.day)) : scopedTransactions();
  return sortTransactions(base).filter(
    (t) =>
      (f.type === 'all' || t.type === f.type) &&
      (!f.category || t.category === f.category) &&
      (!f.day || t.date === f.day) &&
      (!q || t.note.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)),
  );
}

function renderTxList(): void {
  const list = document.getElementById('tx-list');
  if (!list) return;
  const txs = filteredTransactions();
  if (!txs.length) {
    list.innerHTML = empty(
      state.transactions.length
        ? 'No transactions match.'
        : 'Nothing here yet. Add an income or expense to get started.',
    );
    return;
  }
  const tot = totals(txs);
  let lastDate = '';
  const items = txs
    .map((t) => {
      const head = t.date !== lastDate ? `<li class="date-head">${dayLabel(t.date)}</li>` : '';
      lastDate = t.date;
      return `${head}<li class="tx ${t.type} ${t.id === state.editingId ? 'editing' : ''}">
        <span class="tx-icon">${t.type === 'income' ? '↓' : '↑'}</span>
        <div class="tx-main"><b>${escapeHtml(t.category)}</b>${t.note ? `<small>${escapeHtml(t.note)}</small>` : ''}</div>
        <span class="tx-amt">${t.type === 'income' ? '+' : '−'}${money(t.amount)}</span>
        <div class="tx-actions">
          <button class="icon-btn" data-edit="${t.id}" aria-label="Edit">✎</button>
          <button class="icon-btn" data-delete="${t.id}" aria-label="Delete">🗑</button>
        </div>
      </li>`;
    })
    .join('');
  list.innerHTML = `
    <div class="list-total">${txs.length} shown · <span class="pos">${money(tot.income)}</span> in · <span class="neg">${money(tot.expense)}</span> out · net <b class="${netClass(tot.net)}">${signed(tot.net)}</b></div>
    <ul class="tx-list">${items}</ul>`;
}

// ---- form ----

function setFormType(type: TxType): void {
  state.formType = type;
  app.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.type === type));
  });
  form.el.dataset.type = type;
  form.submit.textContent = state.editingId
    ? 'Save changes'
    : type === 'income'
      ? 'Add income'
      : 'Add expense';
  const cats = categoriesFor(type);
  if (!state.editingId && !cats.includes(form.category.value)) form.category.value = '';
  $('category-list').innerHTML = cats
    .map((c) => `<option value="${escapeHtml(c)}"></option>`)
    .join('');
  $('category-chips').innerHTML = cats
    .slice(0, 8)
    .map(
      (c) =>
        `<button type="button" class="chip ${c === form.category.value ? 'active' : ''}" data-chip="${escapeHtml(c)}">${escapeHtml(c)}</button>`,
    )
    .join('');
}

/** Default date: today when viewing the current month, else the 1st of the viewed month. */
function defaultDate(): string {
  const today = toISODate(new Date());
  return monthOf(today) === state.month ? today : `${state.month}-01`;
}

function resetForm(): void {
  state.editingId = null;
  form.amount.value = '';
  form.category.value = '';
  form.note.value = '';
  form.date.value = defaultDate();
  form.error.textContent = '';
  form.cancel.hidden = true;
  $('form-title').textContent = 'Add transaction';
  setFormType(state.formType);
}

function startEdit(id: string): void {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return;
  state.editingId = id;
  form.amount.value = (t.amount / 100).toFixed(2);
  form.category.value = t.category;
  form.date.value = t.date;
  form.note.value = t.note;
  form.error.textContent = '';
  form.cancel.hidden = false;
  $('form-title').textContent = 'Edit transaction';
  setFormType(t.type);
  renderTxList();
  form.amount.focus();
  form.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

form.el.addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = parseAmount(form.amount.value);
  const category = form.category.value.trim().replace(/\s+/g, ' ');
  const date = form.date.value;
  if (amount === null)
    return void (form.error.textContent = 'Enter an amount greater than 0 (up to 2 decimals).');
  if (!category) return void (form.error.textContent = 'Pick or type a category.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return void (form.error.textContent = 'Pick a date.');
  const tx: Transaction = {
    id: state.editingId ?? newId(),
    type: state.formType,
    amount,
    category,
    date,
    note: form.note.value.trim(),
  };
  if (state.editingId) {
    state.transactions = state.transactions.map((t) => (t.id === tx.id ? tx : t));
  } else {
    state.transactions.push(tx);
  }
  persist();
  state.month = monthOf(date);
  state.year = Number(date.slice(0, 4));
  resetForm();
  render();
  form.amount.focus();
});

form.cancel.onclick = () => {
  resetForm();
  renderTxList();
};

app.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((b) => {
  b.onclick = () => setFormType(b.dataset.type as TxType);
});

form.category.addEventListener('input', () => {
  $('category-chips')
    .querySelectorAll<HTMLButtonElement>('[data-chip]')
    .forEach((c) => c.classList.toggle('active', c.dataset.chip === form.category.value));
});

$('category-chips').addEventListener('click', (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-chip]');
  if (!chip) return;
  form.category.value = chip.dataset.chip!;
  form.category.dispatchEvent(new Event('input'));
});

// ---- navigation & view events ----

function goMonth(month: string): void {
  state.month = month;
  state.year = Number(month.slice(0, 4));
  state.filter.day = '';
  if (!state.editingId) form.date.value = defaultDate();
  render();
}

$('prev-month').onclick = () => goMonth(addMonths(state.month, -1));
$('next-month').onclick = () => goMonth(addMonths(state.month, 1));
$('this-month').onclick = () => goMonth(monthOf(toISODate(new Date())));

function setTab(tab: Tab): void {
  state.tab = tab;
  persistPrefs();
  render();
}

app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
  b.onclick = () => setTab(b.dataset.tab as Tab);
});

function showDay(day: string): void {
  state.filter = { type: 'all', category: '', day, search: '' };
  setTab('transactions');
}

view.addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  const day = el.closest<HTMLElement>('[data-day]')?.dataset.day;
  if (day && dailyBreakdown(state.transactions, state.month).find((d) => d.date === day)?.count)
    return showDay(day);

  const month = el.closest<HTMLElement>('[data-month]')?.dataset.month;
  if (month) {
    state.tab = 'daily';
    persistPrefs();
    return goMonth(month);
  }

  const cat = el.closest<HTMLElement>('[data-category]');
  if (cat) {
    state.filter = {
      type: cat.dataset.catType as TxType,
      category: cat.dataset.category!,
      day: '',
      search: '',
    };
    return setTab('transactions');
  }

  const scope = el.closest<HTMLElement>('[data-scope]')?.dataset.scope as Scope | undefined;
  if (scope) {
    state.scope = scope;
    persistPrefs();
    return renderView();
  }

  if (el.closest('#prev-year')) return (state.year--, renderView());
  if (el.closest('#next-year')) return (state.year++, renderView());
  if (el.closest('#clear-day')) return ((state.filter.day = ''), renderView());

  const editId = el.closest<HTMLElement>('[data-edit]')?.dataset.edit;
  if (editId) return startEdit(editId);

  const delId = el.closest<HTMLElement>('[data-delete]')?.dataset.delete;
  if (delId) {
    const t = state.transactions.find((x) => x.id === delId);
    if (
      t &&
      confirm(`Delete ${t.type} of ${money(t.amount)} (${t.category}) on ${dayLabel(t.date)}?`)
    ) {
      state.transactions = state.transactions.filter((x) => x.id !== delId);
      if (state.editingId === delId) resetForm();
      persist();
      render();
    }
  }
});

view.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'show-empty') {
    state.showEmptyDays = el.checked;
    persistPrefs();
    renderView();
  } else if (el.id === 'flt-type') {
    state.filter.type = el.value as TxType | 'all';
    renderTxList();
  } else if (el.id === 'flt-category') {
    state.filter.category = el.value;
    renderTxList();
  }
});

view.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id !== 'flt-search') return;
  state.filter.search = el.value;
  renderTxList();
});

// ---- currency, import & export ----

const currencySelect = $<HTMLSelectElement>('currency');
currencySelect.value = state.currency;
currencySelect.onchange = () => {
  setCurrency(currencySelect.value);
  persist();
  render();
};

function download(name: string, type: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => toISODate(new Date());
$('export-csv').onclick = () =>
  download(`money-tracker-${stamp()}.csv`, 'text/csv', toCSV(state.transactions));
$('export-json').onclick = () =>
  download(
    `money-tracker-backup-${stamp()}.json`,
    'application/json',
    JSON.stringify(
      {
        app: 'money-tracker',
        version: 1,
        currency: state.currency,
        transactions: state.transactions,
      },
      null,
      2,
    ),
  );

const fileInput = $<HTMLInputElement>('import-file');
$('import').onclick = () => fileInput.click();
fileInput.onchange = async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  const text = await file.text();
  let incoming: Transaction[] = [];
  let skipped = 0;
  try {
    if (file.name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('{')) {
      const data = JSON.parse(text) as { transactions?: unknown[] };
      const list = Array.isArray(data.transactions) ? data.transactions : [];
      const known = new Set(state.transactions.map((t) => t.id));
      incoming = list.filter(isTransaction).filter((t) => !known.has(t.id));
      skipped = list.length - incoming.length;
    } else {
      const res = fromCSV(text, newId);
      incoming = res.transactions;
      skipped = res.skipped.length;
    }
  } catch {
    alert(
      "That file couldn't be read. Import a CSV (date,type,category,amount,note) or a Money Tracker backup.",
    );
    return;
  }
  if (!incoming.length) {
    alert(`Nothing new to import${skipped ? ` (${skipped} rows skipped)` : ''}.`);
    return;
  }
  if (!confirm(`Import ${incoming.length} transactions${skipped ? ` (${skipped} skipped)` : ''}?`))
    return;
  state.transactions.push(...incoming);
  persist();
  goMonth(monthOf(sortTransactions(incoming)[0]!.date));
};

resetForm();
render();
