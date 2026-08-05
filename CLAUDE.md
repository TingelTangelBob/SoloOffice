# Claude Code entrypoint

This repository is SoloOffice. Before non-trivial work, read:

- [`CONTEXT.md`](CONTEXT.md) for project facts, architecture and domain rules.
- [`EXPECTATIONS.md`](EXPECTATIONS.md) for the user's working and quality expectations.

Keep this file as a tool-specific bootstrap only. Do not duplicate project knowledge here; update the two central files instead when the product or collaboration rules change.

## Claude-specific reminders

- Work in the existing repository and preserve unrelated Working Tree changes.
- All development and builds run in Docker; do not run host `npm` commands.
- Use `.js` extensions for backend ES-module imports.
- For current agent skills, issue-tracker rules and domain documentation, follow the references under `.agents/` and `docs/` when the task requires them.
