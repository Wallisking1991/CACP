import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageAttachments } from "../src/components/Thread.js";

const imageAttachment = {
  attachment_id: "attachment_1",
  name: "diagram.png",
  media_type: "image/png",
  size_bytes: 1024,
  sha256: "a".repeat(64),
  kind: "image" as const,
  disposition: "inline" as const,
};

describe("message attachment visibility", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("waits until an inline image approaches the viewport before loading it", async () => {
    let observerCallback: IntersectionObserverCallback | undefined;
    const observer = {
      root: null,
      rootMargin: "400px",
      thresholds: [0],
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
      takeRecords: vi.fn(() => []),
    } as unknown as IntersectionObserver;
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn((callback: IntersectionObserverCallback) => {
        observerCallback = callback;
        return observer;
      })
    );
    const loadAttachment = vi.fn(() => new Promise<Blob>(() => {}));

    render(
      <MessageAttachments
        attachments={[imageAttachment]}
        loadAttachment={loadAttachment}
      />
    );

    expect(loadAttachment).not.toHaveBeenCalled();
    expect(observer.observe).toHaveBeenCalledOnce();

    const target = vi.mocked(observer.observe).mock.calls[0][0];
    act(() => {
      observerCallback?.(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        observer
      );
    });

    await waitFor(() =>
      expect(loadAttachment).toHaveBeenCalledWith(imageAttachment)
    );
  });

  it("reserves the inline preview area before the image is downloaded", () => {
    const observer = {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
      takeRecords: vi.fn(() => []),
    } as unknown as IntersectionObserver;
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(() => observer)
    );

    const { container } = render(
      <MessageAttachments
        attachments={[imageAttachment]}
        loadAttachment={() => new Promise<Blob>(() => {})}
      />
    );

    expect(
      container.querySelector(".message-attachment__preview-frame")
    ).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });
});
