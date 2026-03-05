# Changelog

All notable changes to this package will be documented in this file.

## [1.1.2] - 2026-03-04

### Chore

- Version bump to re-trigger the CI/CD pipeline.

## [1.1.1] - 2026-03-04

### Fixed

- Re-wrote `README.md` using `create_file` to ensure valid UTF-8 encoding (previous write via PowerShell heredoc produced Windows-1252, breaking the package build).

## [1.1.0] - 2026-03-04

### Fixed

- Corrected package description in `pyproject.toml` (was copy-pasted from a different project).
- Corrected `[tool.hatch.build.targets.wheel]` package path (was pointing to `mightydatainc_json_surgery`).
- Rewrote `README.md` to document this package accurately.
