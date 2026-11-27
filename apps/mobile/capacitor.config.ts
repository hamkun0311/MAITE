import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "com.oestewdio.maite",
  appName: "MAITE",
  webDir: "dist",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false },
  plugins: { SystemBars: { insetsHandling: "native", style: "LIGHT" } },
};
export default config;
