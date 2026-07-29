import { readFile } from "node:fs/promises";
import { extname, basename } from "node:path";
import { fileTypeFromFile } from "file-type";
import type { AttachmentDisposition, AttachmentKind } from "@cacp/protocol";

export interface ValidatedAttachment {
  name: string;
  mediaType: string;
  kind: AttachmentKind;
  disposition: AttachmentDisposition;
}

const ImageExtensions = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
]);
const OfficeExtensions = new Map([
  [
    ".docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  [
    ".xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  [
    ".pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
]);
const TextExtensions = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".py",
  ".rb",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".kts",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cxx",
  ".hpp",
  ".cs",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".sql",
]);
const GenericMediaTypes = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);

function cleanName(input: string): string {
  const name = [...basename(input)]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join("")
    .trim();
  if (!name || name.length > 255) throw new Error("invalid_attachment_name");
  return name;
}

function mediaTypeMatches(claimed: string, detected: string): boolean {
  if (GenericMediaTypes.has(claimed)) return true;
  if (claimed === detected) return true;
  return claimed === "image/jpg" && detected === "image/jpeg";
}

async function assertTextFile(path: string): Promise<void> {
  const sample = (await readFile(path)).subarray(0, 64 * 1024);
  if (sample.includes(0)) throw new Error("unsupported_attachment_type");
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
  } catch {
    throw new Error("unsupported_attachment_type");
  }
}

export async function validateAttachment(input: {
  path: string;
  filename: string;
  claimedMediaType?: string;
}): Promise<ValidatedAttachment> {
  const name = cleanName(input.filename);
  const extension = extname(name).toLowerCase();
  const claimed = (input.claimedMediaType ?? "").toLowerCase();
  const detected = await fileTypeFromFile(input.path);

  if (extension === ".pdf") {
    if (detected?.mime !== "application/pdf")
      throw new Error("attachment_type_mismatch");
    if (!mediaTypeMatches(claimed, detected.mime))
      throw new Error("attachment_type_mismatch");
    return {
      name,
      mediaType: "application/pdf",
      kind: "pdf",
      disposition: "inline",
    };
  }

  const imageMediaType = ImageExtensions.get(extension);
  if (imageMediaType) {
    if (extension === ".svg") {
      await assertTextFile(input.path);
      if (
        !GenericMediaTypes.has(claimed) &&
        claimed !== "image/svg+xml" &&
        claimed !== "text/plain"
      )
        throw new Error("attachment_type_mismatch");
      return {
        name,
        mediaType: "image/svg+xml",
        kind: "file",
        disposition: "download",
      };
    }
    if (!detected || detected.mime !== imageMediaType)
      throw new Error("attachment_type_mismatch");
    if (!mediaTypeMatches(claimed, detected.mime))
      throw new Error("attachment_type_mismatch");
    return {
      name,
      mediaType: detected.mime,
      kind: "image",
      disposition: "inline",
    };
  }

  const officeMediaType = OfficeExtensions.get(extension);
  if (officeMediaType) {
    if (!detected || detected.mime !== officeMediaType)
      throw new Error("attachment_type_mismatch");
    if (!mediaTypeMatches(claimed, detected.mime))
      throw new Error("attachment_type_mismatch");
    return {
      name,
      mediaType: officeMediaType,
      kind: "office",
      disposition: "download",
    };
  }

  if (TextExtensions.has(extension)) {
    if (detected) throw new Error("attachment_type_mismatch");
    await assertTextFile(input.path);
    const isHtml = extension === ".html" || extension === ".htm";
    const mediaType =
      extension === ".json" || extension === ".jsonc"
        ? "application/json"
        : extension === ".csv"
          ? "text/csv"
          : isHtml
            ? "text/html"
            : "text/plain";
    if (
      !GenericMediaTypes.has(claimed) &&
      !claimed.startsWith("text/") &&
      claimed !== "application/json"
    )
      throw new Error("attachment_type_mismatch");
    return {
      name,
      mediaType,
      kind: "text",
      disposition: isHtml ? "download" : "inline",
    };
  }

  throw new Error("unsupported_attachment_type");
}
