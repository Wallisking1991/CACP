import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { connectorVersion } from "./build-config.js";

const cacpServer = "http://127.0.0.1:3737";

export default defineConfig({
  plugins: [react()],
  define: {
    __CONNECTOR_VERSION__: JSON.stringify(connectorVersion)
  },
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
