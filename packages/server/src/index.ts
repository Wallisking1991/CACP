import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 3737);
const host = process.env.HOST ?? "127.0.0.1";
const app = await buildServer({ dbPath: process.env.CACP_DB ?? "cacp.db" });
await app.listen({ port, host });
console.log(`CACP server listening on http://${host}:${port}`);