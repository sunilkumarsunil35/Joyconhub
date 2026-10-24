import './money.css';
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
import {
  isNative,
  onBackButton,
  onResume,
  openAppSettings,
  readSms,
  saveTextFile,
  smsPermission,
  smsSupported,
} from './native.ts';
import { transactionsFromSms } from './sms.ts';
import { escapeHtml, readJSON, writeJSON } from './storage.ts';

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

const DATA_KEY = 'money-tracker.data.v1';
const PREFS_KEY = 'money-tracker.prefs';
const SMS_KEY = 'money-tracker.sms';
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

const saved = readJSON<Saved>(DATA_KEY, { transactions: [], currency: guessCurrency() });
const state = {
  transactions: (Array.isArray(saved.transactions) ? saved.transactions : []).filter(isTransaction),
  currency: CURRENCIES.includes(saved.currency) ? saved.currency : guessCurrency(),
  ...readJSON<Prefs>(PREFS_KEY, { tab: 'daily', scope: 'month', showEmptyDays: false }),
  month: monthOf(toISODate(new Date())),
  year: new Date().getFullYear(),
  formType: 'expense' as TxType,
  editingId: null as string | null,
  filter: { type: 'all' as TxType | 'all', category: '', day: '', search: '' },
};

function persist(): void {
  writeJSON(DATA_KEY, { transactions: state.transactions, currency: state.currency });
}

function persistPrefs(): void {
  const { tab, scope, showEmptyDays } = state;
  writeJSON(PREFS_KEY, { tab, scope, showEmptyDays });
}

interface SmsSettings {
  enabled: boolean;
  /** Messages received after this time (ms) are still to be read. */
  since: number;
  /** Inbox ids already handled, so a message is never added twice. */
  seen: string[];
  lastChecked: number;
  /** The SMS permission was refused (or blocked by Android's restricted settings). */
  denied: boolean;
  bannerDismissed: boolean;
}

const sms = readJSON<SmsSettings>(SMS_KEY, {
  enabled: false,
  since: 0,
  seen: [],
  lastChecked: 0,
  denied: false,
  bannerDismissed: false,
});

function persistSms(): void {
  writeJSON(SMS_KEY, sms);
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
/** Drops ".00" from whole amounts, for the summary cards where space is tight. */
const short = (minor: number) =>
  minor % 100 ? money(minor) : moneyFmt.format(minor / 100).replace(/[.,]00(?=\D*$)/, '');
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
      <span class="logo"><span class="coin">₹</span>Money <b>Tracker</b></span>
      <button class="icon-btn" id="menu-open" aria-label="Menu">⋮</button>
    </header>

    <nav class="month-nav" aria-label="Month">
      <button class="icon-btn" id="prev-month" aria-label="Previous month">‹</button>
      <h1 id="month-title"></h1>
      <button class="icon-btn" id="next-month" aria-label="Next month">›</button>
      <button class="ghost small" id="this-month">Today</button>
    </nav>

    <section class="summary" id="summary"></section>

    <main class="views" id="view"></main>

    <nav class="tabbar" role="tablist">
      <button role="tab" data-tab="daily"><i>📅</i>Daily</button>
      <button role="tab" data-tab="monthly"><i>📊</i>Monthly</button>
      <button role="tab" data-tab="categories"><i>🏷️</i>Categories</button>
      <button role="tab" data-tab="transactions"><i>🧾</i>History</button>
    </nav>

    <button class="fab" id="add-open" aria-label="Add income or expense">+</button>

    <div class="backdrop" id="backdrop" hidden></div>

    <section class="sheet" id="tx-sheet" role="dialog" aria-modal="true" aria-labelledby="form-title" hidden>
      <div class="sheet-head">
        <h2 id="form-title">Add transaction</h2>
        <button class="icon-btn" id="f-close" aria-label="Close">✕</button>
      </div>
      <form id="tx-form" autocomplete="off">
        <div class="segmented" role="radiogroup" aria-label="Type">
          <button type="button" data-type="expense" role="radio">− Money out</button>
          <button type="button" data-type="income" role="radio">+ Money in</button>
        </div>
        <label>Amount<input id="f-amount" inputmode="decimal" enterkeyhint="next" placeholder="0.00" required /></label>
        <label>Category<input id="f-category" list="category-list" placeholder="Tap one below or type your own" required /></label>
        <datalist id="category-list"></datalist>
        <div class="chips" id="category-chips"></div>
        <div class="row">
          <label>Date<input id="f-date" type="date" required /></label>
          <label><span>Note <span class="opt">(optional)</span></span><input id="f-note" maxlength="120" enterkeyhint="done" placeholder="e.g. Lunch" /></label>
        </div>
        <p class="form-error" id="form-error" role="alert"></p>
        <div class="form-actions">
          <button type="button" class="ghost danger" id="f-delete" hidden>Delete</button>
          <button type="submit" class="primary" id="f-submit">Add expense</button>
        </div>
      </form>
    </section>

    <section class="sheet" id="menu-sheet" role="dialog" aria-modal="true" aria-label="Menu" hidden>
      <div class="sheet-head">
        <h2>Settings & data</h2>
        <button class="icon-btn" data-close aria-label="Close">✕</button>
      </div>
      <label class="menu-row">Currency
        <select id="currency">${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select>
      </label>
      <button class="menu-row" id="export-json"><span>💾 Back up all data</span><small>Save a file to Drive, Files or WhatsApp</small></button>
      <button class="menu-row" id="import"><span>📥 Restore or import</span><small>From a backup or a CSV (date, type, category, amount, note)</small></button>
      <button class="menu-row" id="export-csv"><span>📤 Export as CSV</span><small>Open it in Excel or Google Sheets</small></button>
      <input type="file" id="import-file" accept=".csv,.json,text/csv,application/json,text/plain" hidden />
      <div id="sms-settings"></div>
      <p class="hint">Your data is stored only on this phone. Back up regularly: uninstalling the app or clearing its data erases it.</p>
    </section>

    <div class="toast" id="toast" role="status" hidden></div>
  </div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = {
  sheet: $('tx-sheet'),
  el: $<HTMLFormElement>('tx-form'),
  amount: $<HTMLInputElement>('f-amount'),
  category: $<HTMLInputElement>('f-category'),
  date: $<HTMLInputElement>('f-date'),
  note: $<HTMLInputElement>('f-note'),
  error: $('form-error'),
  submit: $<HTMLButtonElement>('f-submit'),
  del: $<HTMLButtonElement>('f-delete'),
};
const menu = $('menu-sheet');
const backdrop = $('backdrop');
const view = $('view');

// ---- sheets & toast ----

let openSheet: HTMLElement | null = null;

function showSheet(sheet: HTMLElement): void {
  if (openSheet && openSheet !== sheet) openSheet.hidden = true;
  openSheet = sheet;
  sheet.hidden = false;
  backdrop.hidden = false;
}

function closeSheet(): boolean {
  if (!openSheet) return false;
  openSheet.hidden = true;
  openSheet = null;
  backdrop.hidden = true;
  if (state.editingId) {
    state.editingId = null;
    renderTxList();
  }
  return true;
}

backdrop.onclick = () => closeSheet();
$('f-close').onclick = () => closeSheet();
menu.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => closeSheet();
$('menu-open').onclick = () => showSheet(menu);

let toastTimer = 0;
function toast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2200);
}

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
    <div class="stat income"><span>Money in</span><strong>${short(m.income)}</strong></div>
    <div class="stat expense"><span>Money out</span><strong>${short(m.expense)}</strong></div>
    <div class="stat net ${netClass(m.net)}"><span>Net${m.income ? ` · ${Math.round((m.net / m.income) * 100)}%` : ''}</span><strong>${(m.net > 0 ? '+' : '') + short(m.net)}</strong></div>
    <div class="stat today wide-stat"><span>Spent today</span><strong>${short(t.expense)}</strong>${t.income ? `<small>${short(t.income)} in</small>` : ''}</div>
    <div class="stat balance wide-stat ${netClass(all.net)}"><span>Overall balance</span><strong>${(all.net > 0 ? '+' : '') + short(all.net)}</strong></div>`;
}

function renderView(): void {
  if (state.tab === 'daily') view.innerHTML = smsBanner() + dailyView();
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
      return `<g class="slot" ${attr}="${s.key}">
        <title>${escapeHtml(s.title)}\nIn: ${money(s.income)}\nOut: ${money(s.expense)}</title>
        <rect class="hit" x="${i * slot}" y="0" width="${slot}" height="${H}" />
        ${s.income ? `<rect class="bar-in" x="${x - bar - 1}" y="${H - hi}" width="${bar}" height="${hi}" rx="3" />` : ''}
        ${s.expense ? `<rect class="bar-out" x="${x + 1}" y="${H - he}" width="${bar}" height="${he}" rx="3" />` : ''}
      </g>`;
    })
    .join('');
  return `<div class="chart">
    <div class="legend"><span class="key in"></span>In<span class="key out"></span>Out${max > 1 ? `<span class="max">Peak ${money(max)}</span>` : ''}</div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Money in and out chart">
      <line class="axis" x1="0" x2="${W}" y1="${H}" y2="${H}" />${bars}
    </svg>
    <div class="axis-labels" style="grid-template-columns:repeat(${slots.length},1fr)">${slots
      .map(
        (s, i) => `<span>${i % labelEvery === 0 || i === slots.length - 1 ? s.label : ''}</span>`,
      )
      .join('')}</div></div>`;
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
        <td>${parseDate(d.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</td>
        <td class="num pos">${d.income ? money(d.income) : '–'}</td>
        <td class="num neg">${d.expense ? money(d.expense) : '–'}</td>
        <td class="num wide ${netClass(d.net)}">${d.count ? signed(d.net) : '–'}</td>
        <td class="num ${netClass(d.cumulative)}">${signed(d.cumulative)}</td>
      </tr>`,
    )
    .reverse()
    .join('');
  return `
    <div class="view-head">
      <h2>Daily tracker</h2>
      <label class="check"><input type="checkbox" id="show-empty" ${state.showEmptyDays ? 'checked' : ''}/> Empty days</label>
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
      <span>Avg spend / day <b>${money(Math.round(tot.expense / Math.max(1, spendDays)))}</b></span>
      <span>Biggest day <b>${top?.expense ? `${dayLabel(top.date)} · ${money(top.expense)}` : '–'}</b></span>
      <span>Days with entries <b>${active.length} / ${days.length}</b></span>
    </div>
    ${
      rows
        ? `<div class="table-wrap"><table>
        <thead><tr><th>Day</th><th class="num">In</th><th class="num">Out</th><th class="num wide">Net</th><th class="num">Balance</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Total</td><td class="num pos">${money(tot.income)}</td><td class="num neg">${money(tot.expense)}</td><td class="num wide"></td><td class="num ${netClass(tot.net)}">${signed(tot.net)}</td></tr></tfoot>
      </table></div>
      <p class="hint">Balance is the running total for the month. Tap a day to see its entries.</p>`
        : empty('No entries this month yet. Tap <b>+</b> to add money in or out.')
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
        <td>${parseDate(`${m.month}-01`).toLocaleDateString(undefined, { month: 'short' })}</td>
        <td class="num pos">${m.income ? money(m.income) : '–'}</td>
        <td class="num neg">${m.expense ? money(m.expense) : '–'}</td>
        <td class="num ${netClass(m.net)}">${m.count ? signed(m.net) : '–'}</td>
        <td class="num wide">${m.savingsRate === null ? '–' : `${Math.round(m.savingsRate * 100)}%`}</td>
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
        label: parseDate(`${m.month}-01`).toLocaleDateString(undefined, { month: 'narrow' }),
        title: monthLabel(m.month),
        income: m.income,
        expense: m.expense,
      })),
      'data-month',
    )}
    <div class="mini-stats">
      <span>Avg spend / month <b>${money(Math.round(tot.expense / Math.max(1, active.length)))}</b></span>
      <span>Saved in ${state.year} <b class="${netClass(tot.net)}">${signed(tot.net)}</b></span>
      <span>Savings rate <b>${tot.income ? `${Math.round((tot.net / tot.income) * 100)}%` : '–'}</b></span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Month</th><th class="num">In</th><th class="num">Out</th><th class="num">Net</th><th class="num wide">Saved</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>${state.year}</td><td class="num pos">${money(tot.income)}</td><td class="num neg">${money(tot.expense)}</td><td class="num ${netClass(tot.net)}">${signed(tot.net)}</td><td class="num wide">${tot.income ? `${Math.round((tot.net / tot.income) * 100)}%` : '–'}</td></tr></tfoot>
    </table></div>
    <p class="hint">Tap a month to open its daily tracker.</p>`;
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
                ) => `<li data-category="${escapeHtml(c.category)}" data-cat-type="${type}" title="Show these entries">
                <div class="cat-row"><span class="cat-name">${escapeHtml(c.category)}</span><span class="cat-amt">${money(c.total)}</span></div>
                <div class="cat-bar"><i style="width:${(c.share * 100).toFixed(1)}%"></i></div>
                <div class="cat-meta">${(c.share * 100).toFixed(1)}% · ${c.count} ${c.count === 1 ? 'entry' : 'entries'}</div>
              </li>`,
              )
              .join('')}</ul>`
          : empty(`No ${type === 'expense' ? 'spending' : 'income'} in this period.`)
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
      <h2>History · ${f.day ? dayLabel(f.day) : scopeName()}</h2>
      ${f.day ? '' : scopeControl()}
    </div>
    <div class="filters">
      <select id="flt-type" aria-label="Type">
        <option value="all">In & out</option>
        <option value="expense" ${f.type === 'expense' ? 'selected' : ''}>Money out</option>
        <option value="income" ${f.type === 'income' ? 'selected' : ''}>Money in</option>
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
        ? 'No entries match.'
        : 'Nothing here yet. Tap <b>+</b> to add money in or out.',
    );
    return;
  }
  const tot = totals(txs);
  let lastDate = '';
  const items = txs
    .map((t) => {
      const head = t.date !== lastDate ? `<li class="date-head">${dayLabel(t.date)}</li>` : '';
      lastDate = t.date;
      return `${head}<li class="tx ${t.type} ${t.id === state.editingId ? 'editing' : ''}" data-edit="${t.id}" tabindex="0">
        <span class="tx-icon">${t.type === 'income' ? '↓' : '↑'}</span>
        <div class="tx-main"><b>${escapeHtml(t.category)}${t.source === 'sms' ? ' <span class="badge">SMS</span>' : ''}</b>${t.note ? `<small>${escapeHtml(t.note)}</small>` : ''}</div>
        <span class="tx-amt">${t.type === 'income' ? '+' : '−'}${money(t.amount)}</span>
      </li>`;
    })
    .join('');
  list.innerHTML = `
    <div class="list-total">${txs.length} shown · <span class="pos">${money(tot.income)}</span> in · <span class="neg">${money(tot.expense)}</span> out · net <b class="${netClass(tot.net)}">${signed(tot.net)}</b></div>
    <ul class="tx-list">${items}</ul>
    <p class="hint">Tap an entry to edit or delete it.</p>`;
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
      ? 'Add money in'
      : 'Add money out';
  const cats = categoriesFor(type);
  if (!state.editingId && !cats.includes(form.category.value)) form.category.value = '';
  $('category-list').innerHTML = cats
    .map((c) => `<option value="${escapeHtml(c)}"></option>`)
    .join('');
  $('category-chips').innerHTML = cats
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

function openAdd(): void {
  state.editingId = null;
  form.amount.value = '';
  form.category.value = '';
  form.note.value = '';
  form.date.value = defaultDate();
  form.error.textContent = '';
  form.del.hidden = true;
  $('form-title').textContent = 'Add money in or out';
  setFormType(state.formType);
  showSheet(form.sheet);
  form.amount.focus();
}

function openEdit(id: string): void {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return;
  state.editingId = id;
  form.amount.value = (t.amount / 100).toFixed(2);
  form.category.value = t.category;
  form.date.value = t.date;
  form.note.value = t.note;
  form.error.textContent = '';
  form.del.hidden = false;
  $('form-title').textContent = 'Edit entry';
  setFormType(t.type);
  renderTxList();
  showSheet(form.sheet);
}

$('add-open').onclick = openAdd;

form.el.addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = parseAmount(form.amount.value);
  const category = form.category.value.trim().replace(/\s+/g, ' ');
  const date = form.date.value;
  if (amount === null)
    return void (form.error.textContent = 'Enter an amount greater than 0 (up to 2 decimals).');
  if (!category) return void (form.error.textContent = 'Pick or type a category.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return void (form.error.textContent = 'Pick a date.');
  const editing = state.editingId;
  const tx: Transaction = {
    id: editing ?? newId(),
    type: state.formType,
    amount,
    category,
    date,
    note: form.note.value.trim(),
  };
  if (editing) {
    state.transactions = state.transactions.map((t) => (t.id === tx.id ? tx : t));
  } else {
    state.transactions.push(tx);
  }
  persist();
  state.editingId = null;
  closeSheet();
  state.month = monthOf(date);
  state.year = Number(date.slice(0, 4));
  render();
  toast(
    editing
      ? 'Changes saved'
      : `${tx.type === 'income' ? 'Money in' : 'Money out'}: ${money(tx.amount)} · ${tx.category}`,
  );
});

form.del.onclick = () => {
  const t = state.transactions.find((x) => x.id === state.editingId);
  if (!t) return;
  if (!confirm(`Delete ${money(t.amount)} (${t.category}) on ${dayLabel(t.date)}?`)) return;
  state.transactions = state.transactions.filter((x) => x.id !== t.id);
  persist();
  state.editingId = null;
  closeSheet();
  render();
  toast('Entry deleted');
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
  render();
}

$('prev-month').onclick = () => goMonth(addMonths(state.month, -1));
$('next-month').onclick = () => goMonth(addMonths(state.month, 1));
$('this-month').onclick = () => goMonth(monthOf(toISODate(new Date())));

function setTab(tab: Tab): void {
  state.tab = tab;
  persistPrefs();
  render();
  window.scrollTo({ top: 0 });
}

app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
  b.onclick = () => {
    if (b.dataset.tab === 'transactions') state.filter.day = '';
    setTab(b.dataset.tab as Tab);
  };
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
  if (editId) openEdit(editId);
});

view.addEventListener('keydown', (e) => {
  const id = (e.target as HTMLElement).dataset.edit;
  if (id && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openEdit(id);
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

// ---- bank SMS ----

function smsBanner(): string {
  if (!smsSupported() || sms.enabled || sms.bannerDismissed) return '';
  return `<div class="banner" id="sms-banner">
    <span>📩</span>
    <p><b>Add entries from bank SMS automatically</b><small>Your bank's debit and credit messages become entries.</small></p>
    <button class="ghost small" data-sms="enable">Turn on</button>
    <button class="icon-btn" data-sms="dismiss" aria-label="Dismiss">✕</button>
  </div>`;
}

function renderSmsSettings(): void {
  const el = $('sms-settings');
  if (!smsSupported()) {
    el.innerHTML = '';
    return;
  }
  const checked = sms.lastChecked
    ? `Last checked ${new Date(sms.lastChecked).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
    : 'Not checked yet';
  el.innerHTML = `
    <label class="menu-row switch-row">
      <span>📩 Auto-add from bank SMS<small>${sms.enabled ? checked : 'Reads bank debit and credit messages on this phone. Nothing leaves the phone.'}</small></span>
      <input type="checkbox" id="sms-toggle" role="switch" ${sms.enabled ? 'checked' : ''} />
    </label>
    ${sms.enabled ? '<button class="menu-row" data-sms="scan"><span>🔄 Check bank SMS now</span><small>New entries are tagged SMS. Tap one to change its category.</small></button>' : ''}
    ${
      sms.denied
        ? `<div class="warn">
            <p><b>Android hasn't allowed SMS access.</b> Open App info, tap <b>⋮ → Allow restricted settings</b> if you see it, then <b>Permissions → SMS → Allow</b>. Come back and switch this on again.</p>
            <button class="ghost small" data-sms="settings">Open App info</button>
          </div>`
        : ''
    }`;
}

let scanning = false;

/** Read new bank SMS and add them as entries. `manual` reports the result even when empty. */
async function scanSms(manual = false): Promise<void> {
  if (!sms.enabled || scanning) return;
  scanning = true;
  try {
    if ((await smsPermission()) !== 'granted') {
      sms.denied = true;
      sms.enabled = false;
      persistSms();
      renderSmsSettings();
      if (manual) showSheet(menu);
      return;
    }
    const messages = await readSms(sms.since);
    const seen = new Set(sms.seen);
    const { transactions, processed } = transactionsFromSms(
      messages,
      state.transactions,
      seen,
      newId,
    );
    sms.since = Math.max(sms.since, ...messages.map((m) => m.date));
    sms.seen = [...sms.seen, ...processed].slice(-3000);
    sms.lastChecked = Date.now();
    sms.denied = false;
    persistSms();
    if (transactions.length) {
      state.transactions.push(...transactions);
      persist();
      render();
      toast(
        transactions.length === 1
          ? `Added from SMS: ${transactions[0]!.type === 'income' ? '+' : '−'}${money(transactions[0]!.amount)} · ${transactions[0]!.category}`
          : `Added ${transactions.length} entries from bank SMS`,
      );
    } else if (manual) {
      toast('No new bank SMS');
    }
    renderSmsSettings();
  } catch (err) {
    if (manual) alert(`Couldn't read SMS: ${err}`);
  } finally {
    scanning = false;
  }
}

async function enableSms(): Promise<void> {
  const permission = await smsPermission(true);
  if (permission !== 'granted') {
    sms.denied = true;
    persistSms();
    renderSmsSettings();
    showSheet(menu);
    return;
  }
  const now = Date.now();
  const monthStart = parseDate(`${monthOf(toISODate(new Date()))}-01`).getTime();
  sms.since = confirm('Also add bank SMS you received earlier this month?') ? monthStart : now;
  sms.enabled = true;
  sms.denied = false;
  persistSms();
  render();
  renderSmsSettings();
  await scanSms(true);
}

app.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest<HTMLElement>('[data-sms]')?.dataset.sms;
  if (action === 'enable') void enableSms();
  else if (action === 'scan') void scanSms(true);
  else if (action === 'settings') void openAppSettings();
  else if (action === 'dismiss') {
    sms.bannerDismissed = true;
    persistSms();
    renderView();
  }
});

app.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id !== 'sms-toggle') return;
  if (el.checked) {
    void enableSms();
  } else {
    sms.enabled = false;
    persistSms();
    renderSmsSettings();
    renderView();
  }
});

onResume(() => {
  // The date may have changed while the app was in the background.
  render();
  void scanSms();
});

// Android back button: close a sheet, then step back to the Daily tab, then leave the app.
onBackButton(() => {
  if (closeSheet()) return true;
  if (state.tab !== 'daily') {
    setTab('daily');
    return true;
  }
  return false;
});

// ---- currency, import & export ----

const currencySelect = $<HTMLSelectElement>('currency');
currencySelect.value = state.currency;
currencySelect.onchange = () => {
  setCurrency(currencySelect.value);
  persist();
  render();
};

async function share(name: string, type: string, body: string): Promise<void> {
  try {
    await saveTextFile(name, type, body);
    if (!isNative) toast(`Saved ${name}`);
  } catch (err) {
    // Closing Android's share sheet without picking an app rejects; that's not an error.
    if (!String(err).toLowerCase().includes('cancel')) alert(`Couldn't save the file: ${err}`);
  }
}

const stamp = () => toISODate(new Date());
$('export-csv').onclick = () =>
  share(`money-tracker-${stamp()}.csv`, 'text/csv', toCSV(state.transactions));
$('export-json').onclick = () =>
  share(
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
  if (!confirm(`Import ${incoming.length} entries${skipped ? ` (${skipped} skipped)` : ''}?`))
    return;
  state.transactions.push(...incoming);
  persist();
  closeSheet();
  goMonth(monthOf(sortTransactions(incoming)[0]!.date));
  toast(`Imported ${incoming.length} entries`);
};

setFormType(state.formType);
render();
renderSmsSettings();
void scanSms();
