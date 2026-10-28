import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [tailwindcss(), react()],
  server: {
    port: 1420,
    strictPort: true,
  },
});
