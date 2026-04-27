## Summary

Describe the change and why it is needed.

## Validation

Check every command you ran:

- [ ] `corepack pnpm check`
- [ ] Package-focused test: `corepack pnpm --filter @cacp/server test`
- [ ] Manual UI/browser check, if applicable
- [ ] Not applicable because this is documentation-only

## Risk Area

Check all that apply:

- [ ] Protocol schema or event compatibility
- [ ] Server auth, invite, pairing, or room governance
- [ ] Local connector or CLI adapter behavior
- [ ] Web UI or i18n
- [ ] Deployment, CI, or repository configuration
- [ ] Documentation only

## Screenshots or Recordings

Add screenshots or short recordings for visible UI changes.

## Security Checklist

- [ ] I did not commit `.env`, `.deploy/*`, `docs/Server info.md`, database files, SSH keys, or tokens.
- [ ] I did not expose room, invite, pairing, participant, or connector secrets in logs or screenshots.
- [ ] I reviewed whether this change affects access control, token handling, or local command execution.
