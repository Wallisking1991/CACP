import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const connectorVersion = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")).version;
