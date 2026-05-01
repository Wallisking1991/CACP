import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const cacpServer = "http://127.0.0.1:3737";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/rooms": {
        target: cacpServer,
        ws: true
      },
      "/health": {
        target: cacpServer
      },
      "/invites": {
        target: cacpServer
      }
    }
  }
});
