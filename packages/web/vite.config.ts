import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { connectorVersion } from "./build-config.js";
import { excalidrawAssetsPlugin } from "./excalidraw-assets-plugin.js";

const cacpServer =
  process.env.CACP_DEV_SERVER_ORIGIN ?? "http://127.0.0.1:3737";

export default defineConfig({
  plugins: [react(), excalidrawAssetsPlugin()],
  define: {
    __CONNECTOR_VERSION__: JSON.stringify(connectorVersion),
    "process.env.IS_PREACT": "false",
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/gsap/")) return "animation";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router")
          )
            return "react-vendor";
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      "/rooms": {
        target: cacpServer,
        ws: true,
      },
      "/health": {
        target: cacpServer,
      },
      "/invites": {
        target: cacpServer,
      },
    },
  },
});
