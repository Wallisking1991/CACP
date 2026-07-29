# CACP v0.3 Experimental Protocol

CACP v0.3 is the current breaking protocol for local tool-agent rooms. It adds structured message content, ephemeral room attachments, and an explicit connector compatibility manifest. It intentionally removes HTTP-based LLM API agents from the active product surface.

## Supported agent types

The reference connector accepts exactly four agent types:

| Agent type       | SDK package                      | Pinned version |
| ---------------- | -------------------------------- | -------------- |
| `claude-code`    | `@anthropic-ai/claude-agent-sdk` | `0.3.220`      |
| `codex-cli`      | `@openai/codex-sdk`              | `0.146.0`      |
| `github-copilot` | `@github/copilot-sdk`            | `1.0.8`        |
| `kimi-cli`       | `@moonshot-ai/kimi-agent-sdk`    | `0.1.8`        |

The server does not accept generic HTTP model-provider agents. Historical database constraints may mention removed agent types only so older local databases can be detected and migrated safely.

## Structured message content

Human messages, accepted main inputs, and agent turn requests carry:

```json
{
  "text": "Review the attached design",
  "attachments": [
    {
      "attachment_id": "att_example",
      "name": "design.pdf",
      "media_type": "application/pdf",
      "size_bytes": 12345,
      "sha256": "<64 lowercase hexadecimal characters>",
      "kind": "pdf",
      "disposition": "inline"
    }
  ]
}
```

Text remains required and is limited to 4,000 characters. A message may bind up to five attachments, each no larger than 10 MiB.

## Attachment flow

1. An authenticated owner or admin streams one multipart file to `POST /rooms/:roomId/attachments`.
2. The server stages the stream outside its final path and enforces file, message, and room quotas.
3. The server checks the filename, claimed media type, detected signature, extension, and UTF-8 validity where applicable.
4. After successful validation, the server atomically commits the bytes and returns an attachment reference.
5. The sender includes returned attachment IDs in `POST /rooms/:roomId/main-inputs`.
6. The server verifies ownership and one-time binding, then emits structured `message.created`, `main_input.accepted`, and `agent.turn.requested` content.
7. The connector downloads each file with its agent bearer token, verifies size and SHA-256, and materializes it below `<working-dir>/.cacp/rooms/<room-id>/attachments/<attachment-id>`.
8. The selected adapter receives either native attachment input or an absolute verified path according to its manifest.

Authenticated room participants may download a bound attachment from `GET /rooms/:roomId/attachments/:attachmentId`. Responses use `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, restrictive Content Security Policy, and a safe content disposition.

## Allowed files and limits

The default limits are:

- 10 MiB per file.
- 5 attachments per message.
- 50 MiB of live attachment bytes per room.
- 15 minutes before an uploaded but unbound attachment is considered abandoned.

Supported content includes raster images, PDF, UTF-8 text/source files, and DOCX/XLSX/PPTX. HTML and SVG are download-only. Archives, executables, and unknown binary formats are rejected.

## Ephemeral lifecycle

Attachment metadata is stored in SQLite and bytes are stored below the configured attachment root. They are room-scoped, not a permanent file library:

- deleting or closing a room immediately deletes its attachment directory and metadata;
- cancelling an input removes attachments bound to that input;
- abandoned uploads are periodically removed;
- startup purges leftover attachment bytes and metadata from an interrupted process;
- connector shutdown removes its room materialization directory.

This lifecycle is a product invariant, not a best-effort retention policy.

## Compatibility handshake

Pairing claims and agent registration include:

```json
{
  "protocol_version": "0.3.0",
  "connector_version": "0.5.0",
  "adapters": [
    {
      "provider": "codex-cli",
      "sdk_package": "@openai/codex-sdk",
      "sdk_version": "0.146.0",
      "input_capabilities": {
        "image": "native",
        "pdf": "file_path",
        "text": "file_path",
        "office": "file_path",
        "file": "file_path",
        "max_attachments": 5
      }
    }
  ]
}
```

Attachment input modes are `native`, `file_path`, or `unsupported`. The reference connector publishes all four adapter entries. A missing/invalid v0.3 manifest or missing selected adapter is rejected with HTTP `426 connector_upgrade_required`; old connectors are never silently treated as attachment-compatible.

## Security boundary

Only the room server and Web UI are public. Tool-agent execution and verified attachment materialization stay on the connector host. Tokens, local paths, connector secrets, and attachment bytes must not be logged. Upload policy validation and connector checksum verification are both required because neither boundary alone is sufficient.
