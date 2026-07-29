export interface ConnectorShutdownTask {
  label: string;
  close: () => Promise<void>;
}

export interface ConnectorShutdownOptions {
  runtimeTasks: ConnectorShutdownTask[];
  cleanupAttachments: () => Promise<void>;
  onError?: (label: string, error: unknown) => void;
}

export async function settleConnectorShutdown(
  options: ConnectorShutdownOptions
): Promise<void> {
  const results = await Promise.allSettled(
    options.runtimeTasks.map((task) =>
      Promise.resolve().then(() => task.close())
    )
  );
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      options.onError?.(options.runtimeTasks[index]!.label, result.reason);
    }
  });

  try {
    await options.cleanupAttachments();
  } catch (error) {
    options.onError?.("room attachments", error);
  }
}
