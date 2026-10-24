/**
 * Turns bank SMS ("Rs.250.00 debited from A/c XX1234 to VPA swiggy@icici ...") into transactions.
 * Pure functions only, so the parser is unit tested without a phone.
 */
import { toISODate, type Transaction, type TxType } from './model.ts';

export interface SmsMessage {
  /** The inbox row id, unique per message on the phone. */
  id: string;
  /** Sender, e.g. `AD-HDFCBK-S` or `VM-SBIUPI`. */
  address: string;
  body: string;
  /** Received time, ms since epoch. */
  date: number;
}

export interface ParsedSms {
  type: TxType;
  /** Minor units. */
  amount: number;
  /** Who was paid, or who paid you, when the message says so. */
  party: string;
  /** Last digits of the account or card, when given. */
  account: string;
  /** Bank / UPI reference number, when given. */
  ref: string;
}

const AMOUNT = String.raw`(\d[\d,]*(?:\.\d{1,2})?)`;
const CURRENCY = String.raw`(?:rs\.?|inr|₹)`;

/** Messages about money that did not (or has not yet) moved, OTPs and marketing. */
const IGNORE = new RegExp(
  [
    String.raw`\botp\b`,
    'one[- ]time password',
    'verification code',
    String.raw`\b(?:failed|declined|unsuccessful|rejected)\b`,
    String.raw`\bwill be (?:debited|credited|deducted)`,
    String.raw`\b(?:is|are|payment) due\b`,
    String.raw`\bdue (?:on|by|date)\b`,
    'amount due',
    String.raw`\bhas requested\b`,
    'collect request',
    String.raw`\brequested (?:money|rs|inr|₹)`,
    String.raw`\bmandate\b`,
    String.raw`\bpre-?approved\b`,
    String.raw`\bapply now\b`,
    String.raw`\boffer\b`,
    String.raw`\bwin\b`,
    String.raw`\bstatement\b`,
  ].join('|'),
  'i',
);

/** A bank message mentions an account, card or payment rail. Filters out shop/delivery SMS. */
const BANKISH =
  /\b(?:a\/c|ac|acct|account|card|upi|vpa|imps|neft|rtgs|atm|bank|wallet|netbanking|ifsc)\b/i;

const DEBIT_WORDS =
  /\b(?:debited|debit|spent|sent|paid|withdrawn|withdrawal|purchase|deducted|used (?:for|at)|dr)\b/i;
// Not bare "credit": "Credit Card" appears in spending messages.
const CREDIT_WORDS = /\b(?:credited|received|deposited|refund(?:ed)?|reversed|reversal|cr)\b/i;

/** Paying a credit card bill: money moving between your own accounts, not spending. */
const CARD_BILL =
  /(?:received|credited|payment)[^.]{0,60}\b(?:towards|to|on|for) (?:your )?(?:\w+ )*?credit ?card\b|credit card (?:bill )?payment (?:of [^ ]+ )?(?:has been )?received/i;

/** Balance and limit clauses carry amounts that are not the transaction amount. */
const BALANCE_CLAUSE = new RegExp(
  String.raw`(?:avl\.?|avbl\.?|available|avail\.?|total|current|clear|closing|ledger|a\/c)?\s*(?:bal(?:ance)?|limit|credit limit)\b[\s:.-]*(?:is\s*)?(?:${CURRENCY})?\s*-?${AMOUNT}`,
  'gi',
);

function firstIndex(re: RegExp, s: string): number {
  const m = re.exec(s);
  return m ? m.index : -1;
}

function toMinor(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function findAmount(body: string): number | null {
  const s = body.replace(BALANCE_CLAUSE, ' ');
  const patterns = [
    new RegExp(String.raw`${CURRENCY}\s*${AMOUNT}`, 'i'),
    new RegExp(String.raw`${AMOUNT}\s*(?:rs\.?|inr)\b`, 'i'),
    // SBI style: "A/C X1234 debited by 120.0 on ..."
    new RegExp(
      String.raw`(?:debited|credited|spent|sent|received)\s+(?:by|with|for|of)\s+${AMOUNT}`,
      'i',
    ),
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    const minor = m && toMinor(m[1]!);
    if (minor) return minor;
  }
  return null;
}

function findAccount(body: string): string {
  const m =
    /\b(?:a\/c|ac|acct|account|card)(?:\s*no\.?)?(?:\s*(?:ending|ending with|ending in))?[\s:]*(?:[x*]+|xx+)?\s*(\d{3,6})\b/i.exec(
      body,
    );
  return m?.[1] ?? '';
}

function findRef(body: string): string {
  const m =
    /\b(?:ref(?:erence)?\.?(?:\s*(?:no|num|number|id))?|upi(?:\s*(?:ref|txn|id))?(?:\s*no)?|txn(?:\s*(?:id|no))?|rrn|utr)[\s:.#-]*(\d[\w]{5,}|[a-z]*\d[\w]{5,})/i.exec(
      body,
    );
  return m?.[1] ?? '';
}

const PARTY_END = String.raw`(?=\s+(?:on|ref|refno|upi|via|avl|avbl|txn|from|thru|through|using|at|dated|date|is|has|if|not|-)\b|[,;:(]|\.(?=\s|$)|\s*$)`;

function cleanParty(raw: string): string {
  let p = raw.trim().replace(/\s+/g, ' ');
  // Prefer the readable part of a UPI handle: "swiggy.stores@axisbank" -> "swiggy.stores"
  if (/^[\w.-]+@[\w.-]+$/.test(p)) p = p.split('@')[0]!;
  p = p.replace(/^(?:vpa|upi|m\/s\.?|mr\.?|ms\.?)\s+/i, '');
  if (/^(?:a\/c|ac|acct|account|your|you|card|beneficiary|x+\d*)\b/i.test(p)) return '';
  if (/^\d+$/.test(p)) return '';
  return p.slice(0, 40);
}

function findParty(body: string, type: TxType): string {
  const words =
    type === 'expense'
      ? String.raw`(?:trf to|transfer to|transferred to|paid to|sent to|to vpa|towards|at|to|info[:\s]*)`
      : String.raw`(?:from vpa|received from|transfer from|trf from|by vpa|from|by)`;
  const re = new RegExp(String.raw`\b${words}\s+([A-Za-z0-9@._&*'\/ -]{2,60}?)${PARTY_END}`, 'gi');
  for (const m of body.matchAll(re)) {
    const p = cleanParty(m[1]!);
    if (p) return p;
  }
  return '';
}

/** Parse one SMS; null when it is not a completed bank debit/credit. */
export function parseBankSms(msg: Pick<SmsMessage, 'address' | 'body'>): ParsedSms | null {
  const body = msg.body.replace(/\s+/g, ' ').trim();
  // Banks send from alphanumeric sender ids (AD-HDFCBK); personal numbers are ignored.
  if (!/[a-z]/i.test(msg.address)) return null;
  if (!BANKISH.test(body) || IGNORE.test(body)) return null;

  const d = firstIndex(DEBIT_WORDS, body);
  const c = firstIndex(CREDIT_WORDS, body);
  if (d < 0 && c < 0) return null;
  // "debited from your a/c and credited to X" is a debit: the first verb wins.
  const type: TxType = d >= 0 && (c < 0 || d < c) ? 'expense' : 'income';
  if (type === 'income' && CARD_BILL.test(body)) return null;

  const amount = findAmount(body);
  if (!amount) return null;
  return {
    type,
    amount,
    party: findParty(body, type),
    account: findAccount(body),
    ref: findRef(body),
  };
}

const CATEGORY_RULES: [TxType, string, RegExp][] = [
  ['income', 'Salary', /\b(?:salary|sal\b|payroll)/i],
  ['income', 'Refunds', /\b(?:refund|reversal|reversed|cashback)/i],
  ['income', 'Investments', /\b(?:dividend|interest|mutual fund|redemption|zerodha|groww)/i],
  [
    'expense',
    'Food & Dining',
    /\b(?:swiggy|zomato|restaurant|cafe|hotel|dominos|pizza|kfc|mcdonald|starbucks|eatsure|dine)/i,
  ],
  [
    'expense',
    'Groceries',
    /\b(?:blinkit|zepto|bigbasket|dmart|grocer|instamart|jiomart|more retail|reliance fresh|supermarket|kirana)/i,
  ],
  [
    'expense',
    'Transport',
    /\b(?:uber|ola|rapido|metro|irctc|petrol|fuel|diesel|hpcl|bpcl|iocl|indian oil|fastag|parking|redbus)/i,
  ],
  [
    'expense',
    'Bills & Utilities',
    /\b(?:electricity|bescom|tneb|msedcl|water|gas|recharge|airtel|jio|vodafone|vi\b|bsnl|broadband|dth|tata ?play|bill ?desk|billpay|postpaid|prepaid)/i,
  ],
  [
    'expense',
    'Shopping',
    /\b(?:amazon|flipkart|myntra|ajio|meesho|nykaa|croma|reliance digital|decathlon|ikea|shop)/i,
  ],
  [
    'expense',
    'Health',
    /\b(?:pharma|pharmacy|medical|hospital|clinic|apollo|1mg|netmeds|medplus|diagnostic|lab)/i,
  ],
  [
    'expense',
    'Entertainment',
    /\b(?:netflix|hotstar|prime video|spotify|bookmyshow|pvr|inox|youtube|sonyliv|zee5)/i,
  ],
  [
    'expense',
    'Travel',
    /\b(?:makemytrip|goibibo|cleartrip|yatra|indigo|air india|vistara|akasa|oyo|airbnb|booking\.com)/i,
  ],
  [
    'expense',
    'Education',
    /\b(?:school|college|university|tuition|course|udemy|coursera|byju|unacademy)/i,
  ],
  ['expense', 'EMI & Loans', /\b(?:emi|loan|nach|ach d)/i],
  ['expense', 'Rent', /\brent\b/i],
  ['expense', 'Other', /\b(?:atm|cash withdrawal|withdrawn)/i],
];

export function guessCategory(parsed: ParsedSms, body: string): string {
  const text = `${parsed.party} ${body}`;
  for (const [type, category, re] of CATEGORY_RULES) {
    if (type === parsed.type && re.test(text)) return category;
  }
  return parsed.type === 'income' ? 'Other income' : 'Other';
}

/** Two SMS for one transaction (e.g. bank + card network) arrive within minutes of each other. */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

function isDuplicate(t: Transaction, existing: readonly Transaction[]): boolean {
  return existing.some(
    (e) =>
      e.source === 'sms' &&
      ((t.ref && e.ref === t.ref) ||
        (e.type === t.type &&
          e.amount === t.amount &&
          Math.abs((e.smsAt ?? 0) - (t.smsAt ?? 0)) < DUPLICATE_WINDOW_MS)),
  );
}

/**
 * New transactions for the given inbox messages, oldest first. Messages already in `seen`
 * (added before, or added and then deleted by the user) are skipped, as are repeats of a
 * transaction already recorded from another SMS.
 */
export function transactionsFromSms(
  messages: readonly SmsMessage[],
  existing: readonly Transaction[],
  seen: ReadonlySet<string>,
  newId: () => string,
): { transactions: Transaction[]; processed: string[] } {
  const out: Transaction[] = [];
  const processed: string[] = [];
  for (const msg of [...messages].sort((a, b) => a.date - b.date)) {
    if (seen.has(msg.id)) continue;
    processed.push(msg.id);
    const p = parseBankSms(msg);
    if (!p) continue;
    const note = [p.party, p.account && `A/c ··${p.account}`].filter(Boolean).join(' · ');
    const t: Transaction = {
      id: newId(),
      type: p.type,
      amount: p.amount,
      category: guessCategory(p, msg.body),
      date: toISODate(new Date(msg.date)),
      note: note || 'Bank SMS',
      source: 'sms',
      smsId: msg.id,
      smsAt: msg.date,
      ...(p.ref ? { ref: p.ref } : {}),
    };
    if (isDuplicate(t, existing) || isDuplicate(t, out)) continue;
    out.push(t);
  }
  return { transactions: out, processed };
}
