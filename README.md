# semantic-match

AI-powered semantic matching and comparison of named item lists, powered by OpenAI. Resolve a user-supplied string to a canonical item in a list -- even when names differ -- and diff two versions of a list to classify each item as unchanged, renamed, removed, or added.

This repo contains cross-language implementations from **Mighty Data Inc.** that can be dropped straight into real projects.

## Design goals

- Minimal abstractions
- Predictable behavior
- Cross-language parity (Python + TypeScript)
- Easy to drop into real projects

Rather than relying purely on exact string matching, `find_semantic_match` / `findSemanticMatch` first checks for an exact name match (case-insensitive, no API call), then falls back to an LLM to resolve conceptual equivalence -- for example, recognising that "Client Identifier" and "Customer ID" refer to the same thing.

## Packages

- TypeScript: `@mightydatainc/semantic-match` (npm) in `packages/typescript-semantic-match`
- Python: `mightydatainc-semantic-match` (PyPI, import as `mightydatainc_semantic_match`) in `packages/python-semantic-match`

Package-specific docs:

- TypeScript: [packages/typescript-semantic-match/README.md](packages/typescript-semantic-match/README.md)
- Python: [packages/python-semantic-match/README.md](packages/python-semantic-match/README.md)

## Feature overview

Core capabilities (Python + TypeScript):

- `find_semantic_match` / `findSemanticMatch` -- finds the best semantic match for a query string within a list, returning its index or `-1`
- `compare_item_lists` / `compareItemLists` -- diffs two versions of a list and classifies each item as `unchanged`, `renamed`, `removed`, or `added`
- `SemanticItem` -- accepted item type: a plain string or a `{ name, description? }` object
- Optional `explanation` parameter on both functions for extra model context

## Quick start

### Python

```python
from openai import OpenAI
from mightydatainc_semantic_match import find_semantic_match, compare_item_lists

client = OpenAI()

items = ["Customer ID", "Order Date", "Total Amount"]

index = find_semantic_match(client, items, "Client Identifier")
print(index)   # 0

results = compare_item_lists(
    client,
    ["Customer ID", "Order Date", "Unit Price"],
    ["Client ID",   "Order Date"],
)
for entry in results:
    print(entry["classification"], entry["item"], entry.get("new_name") or "")
```

### TypeScript

```ts
import OpenAI from "openai";
import {
  findSemanticMatch,
  compareItemLists,
} from "@mightydatainc/semantic-match";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const items = ["Customer ID", "Order Date", "Total Amount"];

const index = await findSemanticMatch(client, items, "Client Identifier");
console.log(index); // 0

const results = await compareItemLists(
  client,
  ["Customer ID", "Order Date", "Unit Price"],
  ["Client ID", "Order Date"],
);
for (const entry of results) {
  console.log(entry.classification, entry.item, entry.newName ?? "");
}
```

## Local dev (Windows)

### Python

From `packages/python-semantic-match`, activate the package venv and run tests:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pytest tests/ -v
```

### TypeScript

From `packages/typescript-semantic-match`:

```powershell
npm ci
npm test
npm run build
```

Live integration tests (real API) require `OPENAI_API_KEY` in your environment.

## Unit testing with live API calls

Some tests intentionally call the real OpenAI API instead of mocking model responses.

This is by design: the core contract includes prompt wording, output parsing, and model behavior working together. Mock-only tests cannot verify whether production prompts still elicit the required structured output.

These tests do have tradeoffs:

- They require `OPENAI_API_KEY` in the test environment.
- They incur a small API cost when run.
- They can be slower than pure unit tests.

Deterministic assertions are still intentional here: tests are written with tightly scoped inputs and clearly defined expected outcomes, so stable structured output is treated as a baseline requirement. If those tests fail, we treat it as a bug in prompt design, output handling, or integration behavior.

## Release process

This repo ships two public packages with aligned versions:

- npm: `@mightydatainc/semantic-match` from `packages/typescript-semantic-match`
- PyPI: `mightydatainc-semantic-match` from `packages/python-semantic-match`

GitHub release automation publishes each package automatically on push to `main` when its package version changes:

- TypeScript checks `packages/typescript-semantic-match/package.json`
- Python checks `packages/python-semantic-match/pyproject.toml`

Before publishing, ensure both versions are updated, then authenticate once locally:

- npm: `npm login`
- PyPI: configure `~/.pypirc` or use `python -m twine upload --repository pypi dist/*`

After publish, tag and push a release tag (example):

```powershell
git tag v1.1.1
git push origin v1.1.1
```
