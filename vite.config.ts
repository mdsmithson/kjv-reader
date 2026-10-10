import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  resolve: { preserveSymlinks: true },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    // Cargo owns Rust files and build artifacts; Tauri handles their reloads.
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
