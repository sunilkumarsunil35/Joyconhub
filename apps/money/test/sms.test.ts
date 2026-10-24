import { describe, expect, it } from 'vitest';
import { guessCategory, parseBankSms, transactionsFromSms, type SmsMessage } from '../src/sms.ts';

const sms = (address: string, body: string) => ({ address, body });

describe('parseBankSms: transactions', () => {
  it('HDFC UPI debit', () => {
    expect(
      parseBankSms(
        sms(
          'AD-HDFCBK-S',
          'Sent Rs.250.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 24/10/26\nRef 429876543210\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808',
        ),
      ),
    ).toEqual({
      type: 'expense',
      amount: 25000,
      party: 'SWIGGY',
      account: '1234',
      ref: '429876543210',
    });
  });

  it('SBI UPI debit without a currency sign', () => {
    expect(
      parseBankSms(
        sms(
          'VM-SBIUPI',
          'Dear UPI user A/C X1234 debited by 120.0 on date 24Oct26 trf to SWIGGY Refno 429812345678. If not u? call 1800111109. -SBI',
        ),
      ),
    ).toEqual({
      type: 'expense',
      amount: 12000,
      party: 'SWIGGY',
      account: '1234',
      ref: '429812345678',
    });
  });

  it('ICICI UPI credit from a person', () => {
    expect(
      parseBankSms(
        sms(
          'JD-ICICIT-S',
          'Dear Customer, Acct XX123 is credited with Rs 5,000.00 on 24-Oct-26 from RAHUL KUMAR. UPI:429811112222-ICICI Bank.',
        ),
      ),
    ).toEqual({
      type: 'income',
      amount: 500000,
      party: 'RAHUL KUMAR',
      account: '123',
      ref: '429811112222',
    });
  });

  it('salary over NEFT ignores the balance amount', () => {
    const body =
      'INR 85,000.00 credited to HDFC Bank A/c XX1234 on 01-10-26 for NEFT Cr-CITI0000001-ACME TECHNOLOGIES PVT LTD-SALARY OCT. Avl bal INR 1,20,000.00';
    const p = parseBankSms(sms('VK-HDFCBK', body))!;
    expect(p).toMatchObject({ type: 'income', amount: 8_500_000, account: '1234' });
    expect(guessCategory(p, body)).toBe('Salary');
  });

  it('balance first, amount second', () => {
    expect(
      parseBankSms(
        sms(
          'AX-BOIIND',
          'Avl Bal Rs 9,500.00. Your A/c XX9876 is debited for Rs 500.00 towards ELECTRICITY BILL',
        ),
      ),
    ).toMatchObject({ type: 'expense', amount: 50000, account: '9876' });
  });

  it('credit card spends', () => {
    const body =
      'Rs.1,299.00 spent on HDFC Bank Card x1234 at AMAZON on 2026-10-20:10:20:11. Avl Lmt: Rs.50,000. Not you? SMS BLOCK 1234 to 7308080808';
    const p = parseBankSms(sms('AD-HDFCBK', body))!;
    expect(p).toMatchObject({ type: 'expense', amount: 129900, party: 'AMAZON', account: '1234' });
    expect(guessCategory(p, body)).toBe('Shopping');
    expect(
      parseBankSms(
        sms(
          'BP-SBICRD',
          'Your SBI Credit Card XX4321 has been used for Rs 799.00 at NETFLIX on 21/10/26',
        ),
      ),
    ).toMatchObject({ type: 'expense', amount: 79900, party: 'NETFLIX', account: '4321' });
  });

  it('Kotak debit to a UPI handle', () => {
    expect(
      parseBankSms(
        sms(
          'AD-KOTAKB',
          'Sent Rs.150.00 from Kotak Bank AC X1234 to zomato.order@paytm on 24-10-26.UPI Ref 429800001111. Not you, https://kotak.com/fraud',
        ),
      ),
    ).toEqual({
      type: 'expense',
      amount: 15000,
      party: 'zomato.order',
      account: '1234',
      ref: '429800001111',
    });
  });

  it('Axis credit without a named sender', () => {
    expect(
      parseBankSms(
        sms(
          'AD-AXISBK',
          'INR 2,500.00 credited to A/c no. XX1234 on 24-10-26 at 10:05:01 IST. Info- UPI/P2A/429855556666/PRIYA S. Avl Bal- INR 10,000.00 - Axis Bank',
        ),
      ),
    ).toMatchObject({ type: 'income', amount: 250000, account: '1234' });
  });

  it('ATM withdrawal and refund', () => {
    const atm = 'Rs.2000 withdrawn at ATM S1AW000123 from A/c XX1234 on 22Oct26. Avl Bal Rs.8000';
    const p = parseBankSms(sms('VM-SBIINB', atm))!;
    expect(p).toMatchObject({ type: 'expense', amount: 200000 });
    expect(guessCategory(p, atm)).toBe('Other');
    const refund = 'Refund of Rs 249.00 for your order has been credited to your A/c XX1234.';
    const r = parseBankSms(sms('AD-ICICIB', refund))!;
    expect(r).toMatchObject({ type: 'income', amount: 24900 });
    expect(guessCategory(r, refund)).toBe('Refunds');
  });
});

describe('parseBankSms: ignored messages', () => {
  it.each([
    [
      'OTP',
      'AD-HDFCBK',
      'OTP for txn of Rs 500.00 at AMAZON on card XX1234 is 123456. Do not share it with anyone.',
    ],
    [
      'failed',
      'AD-ICICIB',
      'Your UPI transaction of Rs 300 from A/c XX1234 has failed. Amount if debited will be refunded.',
    ],
    [
      'bill due',
      'AD-HDFCBK',
      'Your HDFC Bank Credit Card XX4321 bill of Rs 12,000 is due on 05-Nov-26.',
    ],
    [
      'collect request',
      'AD-SBIUPI',
      'RAHUL has requested Rs 500 from you on UPI. Approve in your UPI app to pay. -SBI',
    ],
    [
      'card bill payment',
      'AD-HDFCBK',
      'Payment of Rs 12,000.00 received towards your HDFC Bank Credit Card XX4321. Thank you.',
    ],
    [
      'future debit',
      'AD-AXISBK',
      'Rs 1,500 will be debited from your A/c XX1234 on 05-11-26 for SIP. -Axis Bank',
    ],
    ['balance only', 'AD-SBIINB', 'Avl Bal in A/c XX1234 is Rs 5,000.00 as on 24-10-26.'],
    ['shop SMS', 'AX-AMAZON', 'Your Amazon order of Rs 499 has shipped and will arrive tomorrow.'],
    [
      'loan offer',
      'AD-HDFCBK',
      'Get a pre-approved personal loan of Rs 5,00,000 credited to your A/c in 10 seconds. Apply now',
    ],
    ['personal number', '+919876543210', 'I sent Rs 500 to your bank account, please check'],
  ])('%s', (_name, address, body) => {
    expect(parseBankSms(sms(address, body))).toBeNull();
  });
});

describe('transactionsFromSms', () => {
  let n = 0;
  const newId = () => `t${++n}`;
  const at = (iso: string) => new Date(iso).getTime();
  const msg = (id: string, date: string, body: string, address = 'AD-HDFCBK'): SmsMessage => ({
    id,
    address,
    body,
    date: at(date),
  });

  const inbox = [
    msg(
      '2',
      '2026-10-24T13:00:00',
      'Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On 24/10/26 Ref 111111111111',
    ),
    msg(
      '1',
      '2026-10-01T09:00:00',
      'INR 85,000.00 credited to HDFC Bank A/c XX1234 for NEFT SALARY OCT',
    ),
    msg('3', '2026-10-24T13:02:00', 'Rs.250.00 debited from card x1234 at SWIGGY'), // same payment, second SMS
    msg('4', '2026-10-24T18:00:00', 'Your OTP is 123456'),
    msg('5', '2026-10-24T19:00:00', 'Rs.40.00 spent on HDFC Bank Card x1234 at CHAI POINT'),
  ];

  it('creates entries oldest first, skips non-transactions and duplicates', () => {
    const { transactions, processed } = transactionsFromSms(inbox, [], new Set(), newId);
    expect(transactions.map((t) => [t.date, t.type, t.amount, t.category, t.note])).toEqual([
      ['2026-10-01', 'income', 8_500_000, 'Salary', 'A/c ··1234'],
      ['2026-10-24', 'expense', 25000, 'Food & Dining', 'SWIGGY · A/c ··1234'],
      ['2026-10-24', 'expense', 4000, 'Other', 'CHAI POINT · A/c ··1234'],
    ]);
    expect(transactions.every((t) => t.source === 'sms' && t.smsId)).toBe(true);
    expect(processed.sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('never re-adds a message it has seen, even if that entry was deleted', () => {
    const { transactions } = transactionsFromSms(inbox, [], new Set(['1', '2', '3', '4']), newId);
    expect(transactions.map((t) => t.smsId)).toEqual(['5']);
  });

  it('skips a transaction already recorded from an earlier scan by its reference number', () => {
    const first = transactionsFromSms(inbox.slice(0, 1), [], new Set(), newId).transactions;
    const again = [
      msg(
        '9',
        '2026-10-25T08:00:00',
        'Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY Ref 111111111111',
      ),
    ];
    expect(transactionsFromSms(again, first, new Set(), newId).transactions).toEqual([]);
  });
});
