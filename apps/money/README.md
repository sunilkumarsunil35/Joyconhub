# Money Tracker (Android app)

An Android app for tracking money in and money out: totals by category, a daily tracker and a monthly tracker. It works fully offline, needs no account and asks for no permissions. Your entries never leave your phone.

## Install on your phone

1. On your Android phone, open **https://github.com/sunilkumarsunil35/Joyconhub/releases/latest/download/MoneyTracker.apk**. The download starts straight away.
2. Open the downloaded file. If Android asks, allow your browser or file manager to **install unknown apps**. The app isn't on the Play Store, so Android asks once.
3. Open **Money Tracker** from your home screen.

**Updating:** install a newer APK the same way. It replaces the old version and keeps your entries.

Every push that changes `apps/money/` makes the **Money Tracker Android app** GitHub Actions workflow (`.github/workflows/android.yml`) build a new APK and replace the `money-tracker-latest` release. The link above always points to the newest build.

## Using it

- Tap the **+** button, choose **Money out** or **Money in**, type the amount and tap a category chip (or type your own category). The date defaults to today, and a note is optional.
- **Daily:** a chart and a per-day list for the month showing money in, money out and the running balance. Tap a day to see its entries.
- **Monthly:** every month of the year with net savings and savings rate. Tap a month to open its daily view.
- **Categories:** where the money went and where it came from, for the month, the year or all time. Tap a category to see its entries.
- **History:** every entry, with filters for type, category and note text. Tap an entry to edit or delete it.
- Use **‹ ›** to move between months, and **Today** to jump back to the current month.
- **⋮ menu:**
  - **Currency** (INR, USD, EUR and others).
  - **Back up all data:** shares a JSON file you can save to Drive or Files or send on WhatsApp.
  - **Restore or import:** reads a backup, or a CSV with `date,type,category,amount,note` columns, where `type` is `income`/`expense` or `credit`/`debit`.
  - **Export as CSV:** for Excel or Google Sheets.

Data is stored inside the app. Uninstalling the app or clearing its storage erases it, so take a backup now and then. Android's own device backup may also restore it on a new phone.

## How it's built

- The UI is a small TypeScript + Vite web app (`src/`) running inside a native Android shell built with [Capacitor](https://capacitorjs.com/) (`android/`).
- All calculations live in `src/model.ts`, which doesn't touch the DOM, and are unit tested in `test/model.test.ts`.
- `src/native.ts` holds the Android-specific parts: the share sheet for exports and the back button (closes a sheet, then returns to Daily, then exits).
- Amounts are stored as whole paise or cents, so totals never pick up rounding errors.

### Develop and build locally

```bash
pnpm --filter @joyconhub/money dev         # run the UI in a browser at http://localhost:5180
pnpm --filter @joyconhub/money android:apk # build the APK (needs JDK 21 and the Android SDK)
```

The APK is written to `android/app/build/outputs/apk/release/app-release.apk`. You can also open `android/` in Android Studio after running `pnpm --filter @joyconhub/money android:sync`.

### Signing

APKs are signed with `android/app/money-tracker.keystore`, which is committed on purpose. Every build, from CI or a local machine, then carries the same signature, so updates install over the old version without losing data. The trade-off: the repository is public, so anyone could sign an APK with this key. Only install Money Tracker APKs from this repository's releases. To use a private key instead, generate one with `keytool`, then set the `MONEY_KEYSTORE`, `MONEY_KEYSTORE_PASSWORD`, `MONEY_KEY_ALIAS` and `MONEY_KEY_PASSWORD` environment variables for the build (in CI, from repository secrets). Note that switching keys means uninstalling the old app once, so back up first.
