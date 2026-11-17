import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../..", import.meta.url));
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, ["NEXT_PUBLIC_", "VITE_"]);
  return {
    plugins: [react()], envDir: root,
    define: {
      "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify(env.VITE_API_BASE_URL ?? env.NEXT_PUBLIC_API_BASE_URL ?? ""),
      "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL ?? ""),
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""),
      "process.env.NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED": JSON.stringify(env.NEXT_PUBLIC_ACCOUNT_FEATURES_ENABLED ?? "false"),
      "process.env.NEXT_PUBLIC_ADMOB_REWARDED_ID": JSON.stringify(env.NEXT_PUBLIC_ADMOB_REWARDED_ID ?? ""),
      "process.env.NEXT_PUBLIC_ADMOB_TESTING": JSON.stringify(env.NEXT_PUBLIC_ADMOB_TESTING ?? "true"),
    },
    resolve: { alias: { "@": root, "next/link": fileURLToPath(new URL("./src/link.tsx", import.meta.url)), "next/navigation": fileURLToPath(new URL("./src/navigation.ts", import.meta.url)) } },
    css: { postcss: `${root}/postcss.config.mjs` },
    server: { host: "127.0.0.1", port: 5173, proxy: { "/api": { target: "http://localhost:3000", changeOrigin: true,
      configure(proxy) { proxy.on("proxyReq", request => request.setHeader("Origin", "http://localhost:3000")); },
    } } },
    build: { outDir: "dist", emptyOutDir: true },
  };
});
