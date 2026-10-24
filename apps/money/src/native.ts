/** The few places where the Android app and a plain browser behave differently. */
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

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
