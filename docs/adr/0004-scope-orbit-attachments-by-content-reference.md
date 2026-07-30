---
status: accepted
---

# Scope Orbit attachments by content reference and target Agent grant

CACP treats attachments in Orbit Discussion as human-visible Room Attachments
independent of Agent readiness. Attachment bytes remain only while referenced by
Orbit Notes or Main Inputs; clearing Orbit deletes only unreferenced bytes.

Orbit Promotion atomically creates the selected Main Input references and grants
download access only to the Local Tool Agent targeted by that Main Input, rather
than every Agent in the room. This keeps human collaboration private by default
and makes disclosure to an Agent explicit, at the cost of reference-aware
attachment storage and authorization.
