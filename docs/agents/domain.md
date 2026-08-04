# Domain Docs

This is a single-context repository. Engineering skills use its domain
documentation as the source of truth for language and durable decisions.

## Before exploring

- Read the root `CONTEXT.md`.
- Read the ADRs under `docs/adr/` that are relevant to the area being changed.
- If either location is absent, continue silently. Domain-modeling workflows
  create them only when a term or durable decision is actually resolved.

## File structure

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
└── packages/
```

Do not create `CONTEXT-MAP.md` or package-specific contexts unless the
repository explicitly changes to a multi-context domain layout.

## Use the glossary vocabulary

Use the canonical terms from `CONTEXT.md` in issue titles, specifications,
proposals, hypotheses, and test names. Do not substitute synonyms listed under
`_Avoid_`.

If a required domain concept is missing, reconsider whether new terminology is
necessary or record the gap for `/domain-modeling`.

## Flag ADR conflicts

If proposed work conflicts with an existing ADR, state the conflict explicitly
instead of silently replacing the decision.
