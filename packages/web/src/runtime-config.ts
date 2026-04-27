export type WebDeploymentMode = "local" | "cloud";

export function deploymentModeFromEnv(env: Record<string, string | undefined>): WebDeploymentMode {
  return env.VITE_CACP_DEPLOYMENT_MODE === "cloud" ? "cloud" : "local";
}

export function isCloudMode(env: Record<string, string | undefined> = import.meta.env): boolean {
  return deploymentModeFromEnv(env) === "cloud";
}
