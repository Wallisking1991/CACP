# Open Source Governance Design

## Goal

Prepare CACP for a public GitHub repository where outside developers can contribute safely without receiving production access. The project should be welcoming, but all changes must pass automated validation and maintainer review before they reach `master`.

## Recommended Model

Use a standard controlled open-source model:

- External contributors work from forks and submit pull requests.
- `master` is protected and cannot be pushed to directly.
- Maintainers review and merge PRs.
- CI must pass before merge.
- Core protocol, server, connector, deployment, and workflow changes require owner review.
- Production deployment credentials and server information remain outside the repository.

This keeps contribution friction reasonable while protecting the parts of the project that affect room security, protocol compatibility, local connector behavior, and cloud deployment.

## Repository Files to Add

The implementation should add these public governance files:

- `CONTRIBUTING.md`: contribution workflow, local setup, commands, coding rules, test expectations, PR checklist, and security boundaries.
- `SECURITY.md`: vulnerability reporting policy and instruction not to disclose secrets or exploit details in public issues.
- `.github/PULL_REQUEST_TEMPLATE.md`: summary, validation commands, risk area, screenshots for UI, and security checklist.
- `.github/ISSUE_TEMPLATE/bug_report.yml`: structured bug reports with environment and reproduction steps.
- `.github/ISSUE_TEMPLATE/feature_request.yml`: structured feature proposals with use case and scope.
- `.github/ISSUE_TEMPLATE/config.yml`: disables blank issues and links users to private security reporting.
- `.github/workflows/ci.yml`: GitHub Actions workflow for install, tests, and build.
- `.github/CODEOWNERS`: owner-review rules using the repository owner GitHub handle, team slug, or verified GitHub email address.

`AGENTS.md` remains the contributor guide for AI coding agents. `CONTRIBUTING.md` becomes the human-facing entry point and should link to `AGENTS.md` for AI-assisted contributions.

## CI Design

CI should run on pull requests and pushes to `master`:

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

The workflow should use Node 20+ initially to match the repository guide. It should avoid building or uploading the Windows connector because that artifact is large, ignored, and platform-specific. Connector release packaging can remain a maintainer-only manual process.

## Protected Branch Settings

These settings are configured in GitHub, not committed to the repo:

- Require pull request before merging.
- Require at least one approving review.
- Require review from Code Owners when matching files change.
- Dismiss stale approvals when new commits are pushed.
- Require all conversations to be resolved.
- Require the CI status check to pass.
- Block force pushes and branch deletion for `master`.

## Code Ownership Boundaries

The first `CODEOWNERS` version should require owner review for:

```text
/packages/protocol/
/packages/server/
/packages/cli-adapter/
/deploy/
/.github/workflows/
/package.json
/pnpm-lock.yaml
```

The implementation should use `453043662@qq.com` as the initial CODEOWNER. The email must be attached to a GitHub account with write access to the repository.

## Security Boundaries

Public contributors must not receive or modify production-only material:

- No `.deploy/*` files.
- No `docs/Server info.md`.
- No `.env`, database files, tokens, SSH keys, or production Caddy/systemd secrets.
- No public issue disclosure for vulnerabilities before maintainer review.
- Deployment stays maintainer-only until a separate protected release workflow is designed.

## Acceptance Criteria

The governance setup is complete when:

1. Human contributors can follow `CONTRIBUTING.md` to install, test, and open a PR.
2. PRs automatically run `corepack pnpm check` on GitHub Actions.
3. PRs include enough structured information for review.
4. Security issues have a private reporting path.
5. Sensitive paths remain ignored and out of Git history going forward.
6. `CODEOWNERS` is committed with `453043662@qq.com` as the initial owner, and that email is attached to a GitHub account with write access before branch protection requires Code Owner review.

## Out of Scope for First Version

Do not add CLA, DCO, signed commits, automated release deployment, or mandatory two-review approvals in the first version. These can be added after the project has more contributors and maintainers.
