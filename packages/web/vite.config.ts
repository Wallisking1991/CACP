import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/rooms": "http://127.0.0.1:3737",
      "/health": "http://127.0.0.1:3737"
    }
  }
});