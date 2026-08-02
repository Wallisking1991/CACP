import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhiteboardPromotionDialog } from "../src/components/WhiteboardPromotionDialog.js";

describe("WhiteboardPromotionDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails explicitly when the target Agent cannot receive both artifacts", () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    render(
      <WhiteboardPromotionDialog
        open
        session={{
          room_id: "room_1",
          participant_id: "owner_1",
          token: "secret",
          role: "owner",
        }}
        artifacts={{
          selectedElementIds: ["shape_1"],
          png: new Blob(["png"], { type: "image/png" }),
          source: new Blob(["source"], {
            type: "application/vnd.excalidraw+json",
          }),
        }}
        expectedRevision={3}
        agent={{
          agent_id: "agent_legacy",
          name: "Legacy Agent",
          capabilities: ["legacy"],
          status: "online",
          input_capabilities: {
            image: "native",
            pdf: "unsupported",
            text: "unsupported",
            office: "unsupported",
            file: "unsupported",
            max_attachments: 1,
          },
        }}
        onClose={() => {}}
      />
    );

    expect(
      screen.getByText(/cannot receive both required attachments/u)
    ).toHaveAttribute("role", "alert");
    expect(
      screen.getByRole("button", { name: "Create Main Input" })
    ).toBeDisabled();
  });

  it("uses stable upload keys and cancels in-flight work when the dialog unmounts", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    let uploadCount = 0;
    let promotionSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url.endsWith("/attachments")) {
          uploadCount += 1;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                attachment: {
                  attachment_id: uploadCount === 1 ? "att_png" : "att_source",
                  name:
                    uploadCount === 1
                      ? "selection.png"
                      : "selection.excalidraw",
                  media_type:
                    uploadCount === 1
                      ? "image/png"
                      : "application/vnd.excalidraw+json",
                  size_bytes: 3,
                  sha256: "0".repeat(64),
                  kind: uploadCount === 1 ? "image" : "text",
                  disposition: "inline",
                },
              })
            )
          );
        }
        if (url.endsWith("/whiteboard/promotions")) {
          promotionSignal = init?.signal ?? undefined;
          return new Promise((_resolve, reject) => {
            promotionSignal?.addEventListener(
              "abort",
              () => reject(new DOMException("cancelled", "AbortError")),
              { once: true }
            );
          });
        }
        if (init?.method === "DELETE") {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.reject(new Error(`unexpected request: ${url}`));
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const rendered = render(
      <StrictMode>
        <WhiteboardPromotionDialog
          open
          session={{
            room_id: "room_1",
            participant_id: "owner_1",
            token: "secret",
            role: "owner",
          }}
          artifacts={{
            selectedElementIds: ["shape_1"],
            png: new Blob(["png"], { type: "image/png" }),
            source: new Blob(["source"], {
              type: "application/vnd.excalidraw+json",
            }),
          }}
          expectedRevision={3}
          agent={{
            agent_id: "agent_1",
            name: "Target Agent",
            capabilities: ["kimi-cli"],
            status: "online",
            input_capabilities: {
              image: "native",
              pdf: "native",
              text: "native",
              office: "native",
              file: "file_path",
              max_attachments: 5,
            },
          }}
          onClose={() => {}}
        />
      </StrictMode>
    );

    await Promise.resolve();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")
    ).toHaveLength(0);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Implement this selection." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Main Input" }));

    await waitFor(() => expect(promotionSignal).toBeDefined());
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("dialog")).toHaveFocus();
    const uploadCalls = fetchMock.mock.calls.slice(0, 2);
    const keys = uploadCalls.map(
      ([, init]) => (init?.headers as Record<string, string>)["idempotency-key"]
    );
    expect(keys[0]).toMatch(/^whiteboard-promotion-.+:png$/u);
    expect(keys[1]).toBe(keys[0]?.replace(/:png$/u, ":source"));

    rendered.unmount();

    expect(promotionSignal?.aborted).toBe(true);
    await waitFor(() => {
      const cancelledUrls = fetchMock.mock.calls
        .filter(([, init]) => init?.method === "DELETE")
        .map(([url]) => String(url));
      expect(cancelledUrls).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/attachment-uploads\/.+%3Apng$/u),
          expect.stringMatching(/attachment-uploads\/.+%3Asource$/u),
        ])
      );
    });
  });
});
