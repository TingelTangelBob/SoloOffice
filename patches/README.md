# Security patches

`braces-3.0.4-security` — Depth-Guards für GHSA-vfj7-8cjw-p6xm / CVE-2026-93687,
abgeleitet vom offenen Upstream-PR micromatch/braces#75 (Commit bdb6fda),
Version `3.0.4-security.0` damit `npm audit` den ungepatchten Stand `<=3.0.3` nicht mehr meldet.
Über `overrides.braces` in Root- und Backend-`package.json` eingebunden.
