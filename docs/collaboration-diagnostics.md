# Collaboration diagnostics

CACP emits structured, content-free diagnostics for intermittent room stream,
Orbit Discussion, and Collaborative Whiteboard failures. Each record is one
JSON line with `event: "collaboration_diagnostic"` so production operators can
filter it from the service journal.

The browser batches at most 25 events per authenticated request. The server
validates a strict allowlist before logging anything. Chat text, Orbit Note
text, whiteboard element JSON, participant display names, tokens, invite data,
and raw identifiers are rejected or omitted. Room, participant, client, event,
and update identifiers become 16-character HMAC references using a random
server-process salt. The references are suitable for correlation within the
current Live Room process, but not across server restarts.

For a whiteboard update, correlate the following actions by `room_ref` and
`update_ref`:

1. `update_sent` records the sender's `base_revision`.
2. `server_update_accepted` or `server_update_rejected` records the server
   decision.
3. `server_broadcast_completed` records editor and observer peer counts plus
   successful and failed deliveries.
4. `update_broadcast_received` records receipt by another browser.
5. `remote_apply_completed` records application to that browser's editor.

Room diagnostics use `stream_connecting`, `stream_opened`, `stream_closed`, and
`stream_reconnect_scheduled` for transport lifecycle. `event_received`,
`event_duplicate`, and `state_reconciled` expose replay behavior, while
`state_summary` records only event, message, Orbit Note, and participant counts
plus an anonymized latest-sender reference.

On a systemd deployment, inspect recent records with:

```sh
journalctl -u cacp --since '-2 hours' --output=cat --no-pager \
  | grep '"event":"collaboration_diagnostic"'
```

If one browser reports `update_sent` and the server reports a successful
broadcast, but another browser has no matching receipt, investigate the
transport or proxy. If receipt exists without `remote_apply_completed`, inspect
client hydration/application. A nonzero `failed_peer_count` identifies a stale
server-side whiteboard connection that was isolated from the remaining peers.
