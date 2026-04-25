import { readFileSync } from "node:fs";
import { z } from "zod";

export const AdapterConfigSchema = z.object({
  server_url: z.string().url(),
  room_id: z.string().min(1),
  token: z.string().min(1),
  agent: z.object({
    name: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    working_dir: z.string().default(process.cwd()),
    capabilities: z.array(z.string()).default(["shell.oneshot"])
  })
});

export type AdapterConfig = z.infer<typeof AdapterConfigSchema>;

export function loadConfig(path: string): AdapterConfig {
  return AdapterConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}