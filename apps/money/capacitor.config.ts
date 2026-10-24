import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.sunilkumarsunil35.money',
  appName: 'Money Tracker',
  webDir: 'dist',
  android: {
    // No remote content is loaded; everything ships inside the APK.
    allowMixedContent: false,
  },
  plugins: {
    SystemBars: {
      // Draw under the status/navigation bars; the page pads itself with --safe-area-inset-*.
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      // Light icons on the app's dark background.
      style: 'DARK',
    },
  },
};

export default config;
