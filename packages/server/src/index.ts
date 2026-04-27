import { loadServerConfig } from "./config.js";
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 3737);
const host = process.env.HOST ?? "127.0.0.1";
const config = loadServerConfig();
const app = await buildServer({ dbPath: process.env.CACP_DB ?? "cacp.db", config });
await app.listen({ port, host });
console.log(`CACP server listening on http://${host}:${port}`);
