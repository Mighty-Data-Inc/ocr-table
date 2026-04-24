# Changelog

All notable changes to this package will be documented in this file.

## [1.1.6] - 2026-04-24

### Chore

Version bump to confirm that GitHub Actions will trigger npm publish

## [1.1.3], [1.1.4], [1.1.5] - 2026-04-23 - 2026-04-24

### Fixed

- Made the unit and integration tests much less fragile

## [1.1.2] - 2026-03-04

### Chore

- Version bump to re-trigger the CI/CD pipeline.

## [1.1.1] - 2026-03-04

### Fixed

- Re-wrote `README.md` using `create_file` to ensure valid UTF-8 encoding (previous write via PowerShell heredoc produced Windows-1252).

## [1.1.0] - 2026-03-04

### Fixed

- Corrected package description in `package.json` (was copy-pasted from a different project).
- Rewrote `README.md` to document this package accurately.
