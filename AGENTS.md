# SoloOffice – Agent entrypoint

SoloOffice is a German invoicing and business-management application with eRechnung, EÜR, receipts, assets, authentication and multi-workspace deployment.

Before any non-trivial task, read:

1. [`CONTEXT.md`](CONTEXT.md) – current product, architecture, domain rules and known limitations.
2. [`EXPECTATIONS.md`](EXPECTATIONS.md) – the user's implementation, UX, verification and communication expectations.

These two files are the source of project context and collaboration preferences. Preserve unrelated Working Tree changes and do not reset or overwrite them.

## Non-negotiable project rules

- All visible UI text is German.
- The product name is SoloOffice; old technical names such as Belego may remain in infrastructure identifiers for compatibility.
- Development and builds run in Docker. Do not run `npm` directly on the host.
- Frontend lint and TypeScript checks run during the Docker frontend build:
  `docker compose --env-file .env.<instance> -f docker-compose.yml build frontend`
- Backend uses ES modules; imports use `.js` extensions.
- New database changes require a numbered migration registered in `backend/migrations/index.js`.
- When changing data models, check API, types, demo mode, permissions and backup/restore together.
- No automated test framework is configured; report technical and manual UI verification separately.

## Operational references

Instance scripts and Docker commands are documented in `CONTEXT.md` and the repository scripts. Use the existing instance-specific `.env.<instance>` and `.env.backend.<instance>` files. Never expose secrets from environment files.
