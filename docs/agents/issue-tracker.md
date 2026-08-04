# Issue tracker: Local Markdown

This repository stores issues and specs (also called PRDs) as Markdown files
under `.scratch/`.

## Conventions

- Each feature has one directory: `.scratch/<feature-slug>/`.
- The feature spec is `.scratch/<feature-slug>/spec.md`.
- Each implementation ticket has its own file at
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`.
- Never combine multiple implementation tickets into one file.
- Triage state is recorded near the top of each issue file as `Status:`, using
  the role strings in `triage-labels.md`.
- Comments and conversation history are appended under a `## Comments`
  heading.

## Publishing and fetching

When a skill says to publish to the issue tracker, create the corresponding
file under `.scratch/<feature-slug>/`, creating directories when necessary.

When a skill says to fetch a ticket, read the referenced file. Callers normally
provide its path or issue number.

## Wayfinding operations

For `/wayfinder`, a map is one file and each ticket is a child file:

- Map: `.scratch/<effort>/map.md`, containing Notes, Decisions-so-far, and Fog.
- Child ticket: `.scratch/<effort>/issues/<NN>-<slug>.md`.
- `Type:` records `research`, `prototype`, `grilling`, or `task`.
- `Status:` records `claimed` or `resolved`.
- `Blocked by: NN, NN` records blocking edges.
- The frontier is the first numbered open, unblocked, unclaimed ticket.
- Claim a ticket by setting `Status: claimed` before work starts.
- Resolve a ticket by appending its result under `## Answer`, setting
  `Status: resolved`, and adding a linked decision summary to the map.
