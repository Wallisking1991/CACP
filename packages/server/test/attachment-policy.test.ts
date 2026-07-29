import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateAttachment } from "../src/attachment-policy.js";

const OnePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("attachment policy", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function fixture(name: string, bytes: Buffer | string): string {
    const root = mkdtempSync(join(tmpdir(), "cacp-attachment-policy-"));
    roots.push(root);
    const path = join(root, name);
    writeFileSync(path, bytes);
    return path;
  }

  it("classifies raster images and accepts generic or legacy media claims", async () => {
    const path = fixture("pixel.png", OnePixelPng);
    await expect(
      validateAttachment({
        path,
        filename: "folder/pixel.png",
        claimedMediaType: "application/octet-stream",
      })
    ).resolves.toEqual({
      name: "pixel.png",
      mediaType: "image/png",
      kind: "image",
      disposition: "inline",
    });
    await expect(
      validateAttachment({
        path,
        filename: "pixel.png",
        claimedMediaType: "image/jpeg",
      })
    ).rejects.toThrow("attachment_type_mismatch");
  });

  it("validates PDFs by signature and claimed media type", async () => {
    const path = fixture(
      "document.pdf",
      Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF")
    );
    await expect(
      validateAttachment({
        path,
        filename: "document.pdf",
        claimedMediaType: "application/pdf",
      })
    ).resolves.toMatchObject({
      mediaType: "application/pdf",
      kind: "pdf",
      disposition: "inline",
    });
    await expect(
      validateAttachment({
        path: fixture("fake.pdf", "not a pdf"),
        filename: "fake.pdf",
        claimedMediaType: "application/pdf",
      })
    ).rejects.toThrow("attachment_type_mismatch");
  });

  it("classifies text formats and forces HTML to download", async () => {
    const cases = [
      ["notes.txt", "text/plain", "inline"],
      ["data.json", "application/json", "inline"],
      ["rows.csv", "text/csv", "inline"],
      ["page.html", "text/html", "download"],
    ] as const;
    for (const [name, mediaType, disposition] of cases) {
      await expect(
        validateAttachment({
          path: fixture(name, "hello"),
          filename: name,
          claimedMediaType: mediaType,
        })
      ).resolves.toMatchObject({
        name,
        mediaType,
        kind: "text",
        disposition,
      });
    }
  });

  it("keeps SVG download-only and rejects active-content claim mismatches", async () => {
    const path = fixture(
      "diagram.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    );
    await expect(
      validateAttachment({
        path,
        filename: "diagram.svg",
        claimedMediaType: "text/plain",
      })
    ).resolves.toMatchObject({
      mediaType: "image/svg+xml",
      kind: "file",
      disposition: "download",
    });
    await expect(
      validateAttachment({
        path,
        filename: "diagram.svg",
        claimedMediaType: "text/html",
      })
    ).rejects.toThrow("attachment_type_mismatch");
  });

  it("rejects disguised binaries, invalid UTF-8, unsupported types, and names", async () => {
    await expect(
      validateAttachment({
        path: fixture("binary.txt", Buffer.from([0, 1, 2])),
        filename: "binary.txt",
        claimedMediaType: "text/plain",
      })
    ).rejects.toThrow("unsupported_attachment_type");
    await expect(
      validateAttachment({
        path: fixture("invalid.txt", Buffer.from([0xc3, 0x28])),
        filename: "invalid.txt",
        claimedMediaType: "text/plain",
      })
    ).rejects.toThrow("unsupported_attachment_type");
    await expect(
      validateAttachment({
        path: fixture("archive.zip", "archive"),
        filename: "archive.zip",
      })
    ).rejects.toThrow("unsupported_attachment_type");
    await expect(
      validateAttachment({
        path: fixture("fake.docx", "not an office file"),
        filename: "fake.docx",
      })
    ).rejects.toThrow("attachment_type_mismatch");
    await expect(
      validateAttachment({
        path: fixture("fake.png", "not an image"),
        filename: "fake.png",
      })
    ).rejects.toThrow("attachment_type_mismatch");
    await expect(
      validateAttachment({
        path: fixture("name.txt", "hello"),
        filename: "\u0000",
      })
    ).rejects.toThrow("invalid_attachment_name");
    await expect(
      validateAttachment({
        path: fixture("long.txt", "hello"),
        filename: `${"a".repeat(256)}.txt`,
      })
    ).rejects.toThrow("invalid_attachment_name");
  });
});
