---
status: accepted
---

# Keep room attachments ephemeral

CACP stores uploaded attachment bytes only for the lifetime of a Live Room because rooms are temporary collaboration spaces, not durable file storage. Attachment bytes are deleted when the owner explicitly leaves or the room server restarts; abandoned upload data is also eligible for cleanup. A transport disconnect does not end the room because browser sleep, network changes, and short outages must remain recoverable.
