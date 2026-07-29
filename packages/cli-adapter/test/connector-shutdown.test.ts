import { describe, expect, it, vi } from "vitest";
import { settleConnectorShutdown } from "../src/connector-shutdown.js";

describe("connector shutdown", () => {
  it("waits for runtime shutdown before removing materialized attachments", async () => {
    const order: string[] = [];
    let releaseRuntime: (() => void) | undefined;
    const runtimeClosed = new Promise<void>((resolve) => {
      releaseRuntime = resolve;
    });

    const settled = settleConnectorShutdown({
      runtimeTasks: [
        {
          label: "runtime",
          close: async () => {
            order.push("runtime-start");
            await runtimeClosed;
            order.push("runtime-finished");
          },
        },
      ],
      cleanupAttachments: async () => {
        order.push("attachments-removed");
      },
    });

    await Promise.resolve();
    expect(order).toEqual(["runtime-start"]);
    releaseRuntime?.();
    await settled;
    expect(order).toEqual([
      "runtime-start",
      "runtime-finished",
      "attachments-removed",
    ]);
  });

  it("still removes attachments when a runtime close fails", async () => {
    const cleanupAttachments = vi.fn(async () => undefined);
    const onError = vi.fn();

    await settleConnectorShutdown({
      runtimeTasks: [
        {
          label: "Codex runtime",
          close: () => {
            throw new Error("close failed");
          },
        },
      ],
      cleanupAttachments,
      onError,
    });

    expect(cleanupAttachments).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      "Codex runtime",
      expect.objectContaining({ message: "close failed" })
    );
  });
});
