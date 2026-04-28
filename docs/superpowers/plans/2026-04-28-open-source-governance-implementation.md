# Open Source Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the public GitHub contribution controls needed for CACP to accept outside pull requests safely.

**Architecture:** This change is documentation and repository automation only. Human contribution guidance lives at the repository root, GitHub-specific templates and ownership rules live under `.github/`, and validation runs through a single CI workflow that executes the existing `corepack pnpm check` command.

**Tech Stack:** Markdown, GitHub Issue Forms YAML, GitHub Actions, CODEOWNERS, Node/Corepack/pnpm.

---

## File Structure

- Create `CONTRIBUTING.md`: human-facing contributor guide with setup, workflow, coding, testing, PR, and security rules.
- Create `SECURITY.md`: public vulnerability reporting instructions using `453043662@qq.com`.
- Create `.github/PULL_REQUEST_TEMPLATE.md`: PR checklist that forces validation and risk disclosure.
- Create `.github/ISSUE_TEMPLATE/bug_report.yml`: structured bug report form.
- Create `.github/ISSUE_TEMPLATE/feature_request.yml`: structured feature request form.
- Create `.github/ISSUE_TEMPLATE/config.yml`: disables blank issues and routes security reports to `SECURITY.md`.
- Create `.github/workflows/ci.yml`: pull request and `master` push validation using Node 20 and `corepack pnpm check`.
- Create `.github/CODEOWNERS`: code ownership using `453043662@qq.com`. This email must be attached to a GitHub account with write access to the repository.

## GitHub Settings After Merge

These settings are manual GitHub repository settings and are not committed by this plan:

- Protect `master`.
- Require pull requests before merging.
- Require at least one approval.
- Require Code Owner review.
- Dismiss stale approvals.
- Require conversation resolution.
- Require CI status check `ci` to pass.
- Block force pushes and branch deletion.

---

### Task 1: Add Human Contribution and Security Guides

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`

- [ ] **Step 1: Create `CONTRIBUTING.md`**

Write this exact file:

```markdown
# Contributing to CACP

Thank you for your interest in CACP. This project is a local-first collaborative AI room demo with a cloud room server and a local connector. Contributions are welcome through pull requests.

## Contribution Flow

1. Fork the repository.
2. Create a focused branch from `master`.
3. Make one logical change per pull request.
4. Add or update tests when behavior changes.
5. Run validation locally before opening a pull request.
6. Open a pull request and complete the checklist.

Do not push directly to `master`. Maintainers merge pull requests after review and passing CI.

## Local Setup

Use Node 20+, Corepack, and the pinned pnpm version:

```powershell
corepack enable
corepack pnpm install
corepack pnpm check
```

Useful development commands:

```powershell
corepack pnpm test
corepack pnpm build
corepack pnpm dev:server
corepack pnpm dev:web
corepack pnpm dev:adapter
```

For focused package work:

```powershell
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/web test
```

## Project Areas

- `packages/protocol`: shared TypeScript types, zod schemas, and protocol contracts.
- `packages/server`: Fastify/WebSocket server, SQLite storage, auth, pairing, invites, and room governance.
- `packages/cli-adapter`: local CLI agent connector and runner logic.
- `packages/web`: React + Vite room UI and browser state derivation.
- `docs/`: protocol and design documentation.

Protocol, server, connector, deployment, and CI changes require extra maintainer attention because they affect compatibility, security, or production operations.

## Coding Standards

- Use strict TypeScript.
- Keep ESM/NodeNext-compatible imports with `.js` extensions for relative imports.
- Use two-space indentation, double quotes, and semicolons.
- Prefer small, testable helpers for derived state and protocol logic.
- Keep protocol schema changes centralized in `packages/protocol/src/schemas.ts`.
- Follow existing naming and file organization unless the pull request explains a focused improvement.

## Testing Expectations

Run this before opening a pull request:

```powershell
corepack pnpm check
```

Add or update tests when changing:

- protocol event types or schemas;
- role permissions or participant removal;
- invite, join approval, or pairing flows;
- room-state derivation;
- local connector behavior;
- UI behavior visible to users.

Server tests should prefer in-memory SQLite with `dbPath: ":memory:"`.

## Commit Messages

Use Conventional Commit style:

```text
feat(server): add room governance check
fix(web): mask connector code
docs: clarify local connector setup
chore: update CI workflow
```

Keep commits focused and imperative.

## Pull Request Requirements

Every pull request should include:

- a short summary;
- validation commands run;
- linked issue or context when available;
- screenshots or short recordings for UI changes;
- notes for protocol, security, deployment, or connector risks.

Maintainers may ask for smaller pull requests if the change mixes unrelated concerns.

## Security and Secrets

Never commit secrets or local deployment files, including:

- `.deploy/*`;
- `docs/Server info.md`;
- `.env` files;
- database files such as `*.db`, `*.db-shm`, and `*.db-wal`;
- SSH keys, tokens, invite tokens, participant tokens, or production configuration.

Report security issues privately using `SECURITY.md`. Do not publish exploit details in public issues.
```

- [ ] **Step 2: Create `SECURITY.md`**

Write this exact file:

```markdown
# Security Policy

## Reporting a Vulnerability

Please report suspected vulnerabilities privately by email:

```text
453043662@qq.com
```

Do not open a public GitHub issue for vulnerabilities, exposed secrets, bypasses, token leaks, invite-link abuse, room-join approval bypasses, or local connector execution risks.

## What to Include

Include as much of the following as you can safely share:

- affected package or feature;
- impact and expected severity;
- reproduction steps;
- relevant logs or screenshots with secrets removed;
- whether the issue affects the public cloud room server, local connector, or both.

## Maintainer Response

A maintainer will review the report, reproduce the issue when possible, and coordinate a fix before public disclosure. Public disclosure should wait until a fix or mitigation is available.

## Secret Handling

Do not send production server passwords, SSH private keys, raw room tokens, participant tokens, invite tokens, or database files unless a maintainer explicitly requests a sanitized sample through a private channel.
```

- [ ] **Step 3: Review rendered Markdown locally**

Run:

```powershell
Get-Content CONTRIBUTING.md -Raw
Get-Content SECURITY.md -Raw
```

Expected: both files render readable Markdown and contain no deployment password, server IP, SSH key, or database path beyond the ignored path names documented in the security section.

- [ ] **Step 4: Commit Task 1**

Run:

```powershell
git add CONTRIBUTING.md SECURITY.md
git commit -m "docs: add contribution and security guides"
```

Expected: commit succeeds with only `CONTRIBUTING.md` and `SECURITY.md` staged.

---

### Task 2: Add Pull Request and Issue Templates

**Files:**
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`

- [ ] **Step 1: Create GitHub template directories**

Run:

```powershell
New-Item -ItemType Directory -Force .github | Out-Null
New-Item -ItemType Directory -Force .github\ISSUE_TEMPLATE | Out-Null
```

Expected: `.github/` and `.github/ISSUE_TEMPLATE/` exist.

- [ ] **Step 2: Create `.github/PULL_REQUEST_TEMPLATE.md`**

Write this exact file:

```markdown
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
```

- [ ] **Step 3: Create `.github/ISSUE_TEMPLATE/bug_report.yml`**

Write this exact file:

```yaml
name: Bug report
description: Report a reproducible problem in CACP
title: "bug: "
labels:
  - bug
body:
  - type: markdown
    attributes:
      value: |
        Thanks for reporting a bug. Do not include secrets, tokens, server passwords, SSH keys, or private room links.
  - type: textarea
    id: summary
    attributes:
      label: Summary
      description: What happened?
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Reproduction steps
      description: Provide the smallest sequence that reproduces the problem.
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
      description: What should have happened?
    validations:
      required: true
  - type: textarea
    id: actual
    attributes:
      label: Actual behavior
      description: What happened instead?
    validations:
      required: true
  - type: dropdown
    id: area
    attributes:
      label: Area
      options:
        - protocol
        - server
        - cli-adapter
        - web
        - deployment
        - documentation
        - unsure
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: Commit or version
      description: Paste the commit hash, release version, or branch name.
  - type: textarea
    id: environment
    attributes:
      label: Environment
      description: Include OS, Node version, browser, and relevant local setup.
  - type: textarea
    id: logs
    attributes:
      label: Logs or screenshots
      description: Remove secrets before attaching logs or images.
      render: text
```

- [ ] **Step 4: Create `.github/ISSUE_TEMPLATE/feature_request.yml`**

Write this exact file:

```yaml
name: Feature request
description: Propose a focused improvement for CACP
title: "feat: "
labels:
  - enhancement
body:
  - type: markdown
    attributes:
      value: |
        Please keep feature requests focused. Large proposals may be split into design and implementation steps.
  - type: textarea
    id: problem
    attributes:
      label: Problem or use case
      description: What user need does this solve?
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: Proposed solution
      description: Describe the behavior you want.
    validations:
      required: true
  - type: dropdown
    id: area
    attributes:
      label: Area
      options:
        - protocol
        - server
        - cli-adapter
        - web
        - deployment
        - documentation
        - unsure
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
      description: Describe other options or why the current behavior is insufficient.
  - type: textarea
    id: risks
    attributes:
      label: Compatibility or security risks
      description: Note any protocol, token, room permission, connector, or deployment impact.
```

- [ ] **Step 5: Create `.github/ISSUE_TEMPLATE/config.yml`**

Write this exact file:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Security vulnerability
    url: mailto:453043662@qq.com
    about: Do not open public security issues. Read SECURITY.md and email 453043662@qq.com.
```

- [ ] **Step 6: Validate template files exist and contain expected labels**

Run:

```powershell
Get-ChildItem .github -Recurse | Select-Object FullName,Length
Select-String -Path .github\ISSUE_TEMPLATE\*.yml -Pattern "labels:|bug|enhancement|blank_issues_enabled|mailto:453043662@qq.com"
```

Expected: four template files exist; bug and feature templates include labels; `config.yml` disables blank issues and includes the security email link.

- [ ] **Step 7: Commit Task 2**

Run:

```powershell
git add .github/PULL_REQUEST_TEMPLATE.md .github/ISSUE_TEMPLATE
git commit -m "docs: add GitHub issue and PR templates"
```

Expected: commit succeeds with only the GitHub template files staged.

---

### Task 3: Add GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create workflow directory**

Run:

```powershell
New-Item -ItemType Directory -Force .github\workflows | Out-Null
```

Expected: `.github/workflows/` exists.

- [ ] **Step 2: Create `.github/workflows/ci.yml`**

Write this exact file:

```yaml
name: ci

on:
  pull_request:
  push:
    branches:
      - master

permissions:
  contents: read

jobs:
  check:
    name: pnpm check
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Enable Corepack
        run: corepack enable

      - name: Install dependencies
        run: corepack pnpm install --frozen-lockfile

      - name: Run validation
        run: corepack pnpm check
```

- [ ] **Step 3: Validate workflow content locally**

Run:

```powershell
Get-Content .github\workflows\ci.yml -Raw
Select-String -Path .github\workflows\ci.yml -Pattern "pull_request|master|corepack pnpm check|node-version: 20"
```

Expected: the workflow triggers on pull requests and pushes to `master`, uses Node 20, installs with `--frozen-lockfile`, and runs `corepack pnpm check`.

- [ ] **Step 4: Run repository validation once before committing CI**

Run:

```powershell
corepack pnpm check
```

Expected: all Vitest suites and workspace builds pass.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add .github/workflows/ci.yml
git commit -m "ci: add pull request validation"
```

Expected: commit succeeds with only `.github/workflows/ci.yml` staged.

---

### Task 4: Add Code Ownership Rules

**Files:**
- Create: `.github/CODEOWNERS`

- [ ] **Step 1: Create `.github/CODEOWNERS`**

Write this exact file:

```text
# CODEOWNERS entries use a GitHub username, team, or email attached to a GitHub account with write access.
# Repository owner: 453043662@qq.com

* 453043662@qq.com

/packages/protocol/ 453043662@qq.com
/packages/server/ 453043662@qq.com
/packages/cli-adapter/ 453043662@qq.com
/deploy/ 453043662@qq.com
/.github/workflows/ 453043662@qq.com
/package.json 453043662@qq.com
/pnpm-lock.yaml 453043662@qq.com
```

- [ ] **Step 2: Validate ownership coverage**

Run:

```powershell
Get-Content .github\CODEOWNERS -Raw
Select-String -Path .github\CODEOWNERS -Pattern "packages/protocol|packages/server|packages/cli-adapter|deploy|workflows|pnpm-lock.yaml|453043662@qq.com"
```

Expected: the default owner and all sensitive paths are assigned to `453043662@qq.com`.

- [ ] **Step 3: Commit Task 4**

Run:

```powershell
git add .github/CODEOWNERS
git commit -m "chore: add code owners"
```

Expected: commit succeeds with only `.github/CODEOWNERS` staged.

---

### Task 5: Final Review and Maintainer Handoff

**Files:**
- Inspect: `CONTRIBUTING.md`
- Inspect: `SECURITY.md`
- Inspect: `.github/PULL_REQUEST_TEMPLATE.md`
- Inspect: `.github/ISSUE_TEMPLATE/*.yml`
- Inspect: `.github/workflows/ci.yml`
- Inspect: `.github/CODEOWNERS`

- [ ] **Step 1: Confirm no secret-bearing local files are tracked**

Run:

```powershell
git ls-files .deploy docs/Server\ info.md docs/deploy-cloud.md packages/web/public/downloads/CACP-Local-Connector.exe
```

Expected: no output.

- [ ] **Step 2: Search governance files for accidental production secrets**

Run:

```powershell
Select-String -Path CONTRIBUTING.md,SECURITY.md,.github\**\* -Pattern "password|ssh-rsa|BEGIN OPENSSH|47\.83\.231\.218|Server info|aliyun-server" -CaseSensitive:$false
```

Expected: only safe documentation references to `docs/Server info.md` appear; no IP address, password, private key, or local server config file name is exposed.

- [ ] **Step 3: Run full validation**

Run:

```powershell
corepack pnpm check
```

Expected: all tests and builds pass.

- [ ] **Step 4: Verify final Git history and status**

Run:

```powershell
git log -5 --oneline
git status --short
```

Expected: task commits are visible and working tree is clean.

- [ ] **Step 5: Configure GitHub protected branch after pushing**

In GitHub repository settings, configure `master` rules:

```text
Require pull request before merging: enabled
Required approvals: 1
Dismiss stale approvals: enabled
Require review from Code Owners: enabled
Require conversation resolution: enabled
Required status check: ci / pnpm check
Block force pushes: enabled
Block branch deletion: enabled
```

Expected: contributors cannot merge to `master` unless CI passes and required review is complete.
