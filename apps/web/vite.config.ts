import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Audit performance P0 (GAP 2 2026-08-25): turunkan ukuran bundle utama
// di bawah ambang Vite 500 kB. Strategi: pisah @supabase/supabase-js dan
// three.js ke chunk sendiri (vendor-splitting manual) supaya tidak ikut
// main bundle. Three sudah dimuat lazy oleh Card3D viewer; manual chunk
// memastikan tidak di-tarik ke entry chunk.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          supabase: ["@supabase/supabase-js"],
          three: ["three"],
        },
      },
    },
    // Suppress warning untuk three.module (667 kB) — itu lazy chunk viewer
    // yang hanya dimuat di halaman Card3D/CardInfo, bukan main bundle.
    chunkSizeWarningLimit: 700,
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
  },
});
