/** The few places where the Android app and a plain browser behave differently. */
import { App } from '@capacitor/app';
import { Capacitor, registerPlugin, type PermissionState } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { SmsMessage } from './sms.ts';

export const isNative = Capacitor.isNativePlatform();

/**
 * Hand a text file to the user. In the app this opens Android's share sheet (save to Files or
 * Drive, send on WhatsApp or email, ...); in a browser it downloads the file.
 */
export async function saveTextFile(name: string, type: string, body: string): Promise<void> {
  if (isNative) {
    const { uri } = await Filesystem.writeFile({
      path: name,
      data: body,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({ title: name, files: [uri] });
    return;
  }
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Android back button: `handler` returns true when it handled the press (e.g. closed a sheet). */
export function onBackButton(handler: () => boolean): void {
  if (!isNative) return;
  void App.addListener('backButton', () => {
    if (!handler()) void App.exitApp();
  });
}

/** Resume after being in the background (e.g. the user paid with a UPI app and came back). */
export function onResume(handler: () => void): void {
  if (!isNative) return;
  void App.addListener('resume', handler);
}

// ---- bank SMS (see android/.../BankSmsPlugin.java) ----

interface BankSmsPlugin {
  read(options: { since: string; limit?: number }): Promise<{ messages: SmsMessage[] }>;
  checkPermissions(): Promise<{ sms: PermissionState }>;
  requestPermissions(): Promise<{ sms: PermissionState }>;
  openAppSettings(): Promise<void>;
}

/** Browser stand-in so tests can drive the SMS flow: set `window.__moneyFakeSms`. */
type FakeSms = { messages: SmsMessage[]; permission: PermissionState };
const fake = () => (window as unknown as { __moneyFakeSms?: FakeSms }).__moneyFakeSms;

const BankSms = registerPlugin<BankSmsPlugin>('BankSms');

/** Whether this device can read SMS at all (the Android app, or a test with the fake). */
export const smsSupported = () => isNative || !!fake();

export async function smsPermission(request = false): Promise<PermissionState> {
  const f = fake();
  if (f) return request && f.permission === 'prompt' ? (f.permission = 'granted') : f.permission;
  const res = request ? await BankSms.requestPermissions() : await BankSms.checkPermissions();
  return res.sms;
}

/** Inbox messages received after `since` (ms since epoch). */
export async function readSms(since: number): Promise<SmsMessage[]> {
  const f = fake();
  if (f) return f.messages.filter((m) => m.date > since);
  const { messages } = await BankSms.read({ since: String(since), limit: 2000 });
  return messages;
}

export async function openAppSettings(): Promise<void> {
  if (isNative) await BankSms.openAppSettings();
}
