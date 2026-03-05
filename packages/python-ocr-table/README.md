# mightydatainc-semantic-match

AI-powered semantic matching and comparison of named item lists, powered by OpenAI. Resolve a user-supplied string to a canonical item in a list -- even when names differ -- and diff two versions of a list to classify each item as unchanged, renamed, removed, or added.

## Installation

```bash
pip install mightydatainc-semantic-match
```

## Quick Start

### `find_semantic_match`

Find which item in a list best matches a query string, even if the names are different:

```python
from openai import OpenAI
from mightydatainc_semantic_match import find_semantic_match

client = OpenAI()

items = ["Customer ID", "Order Date", "Total Amount"]

index = find_semantic_match(client, items, "Client Identifier")
print(index)          # 0  ->  "Customer ID"

index = find_semantic_match(client, items, "Product Name")
print(index)          # -1  ->  no match found
```

Items can also carry an optional `description` to give the model more context:

```python
from mightydatainc_semantic_match import find_semantic_match, ComparableNamedItem

items: list[ComparableNamedItem] = [
    {"name": "MRR", "description": "Monthly Recurring Revenue"},
    {"name": "ARR", "description": "Annual Recurring Revenue"},
    {"name": "Churn Rate"},
]

index = find_semantic_match(client, items, "monthly subscription revenue")
print(index)          # 0  ->  "MRR"
```

An optional `explanation` string can be passed to give the model additional context:

```python
index = find_semantic_match(
    client,
    items,
    "monthly subscription revenue",
    explanation="These are SaaS business metrics.",
)
```

Exact name matches (case-insensitive) are resolved locally without an API call.

### `compare_item_lists`

Diff two versions of an item list and classify every item:

```python
from mightydatainc_semantic_match import compare_item_lists, ItemComparisonClassification

before = ["Customer ID", "Order Date", "Unit Price", "Total Amount"]
after  = ["Client ID",   "Order Date", "Grand Total"]

results = compare_item_lists(client, before, after)

for entry in results:
    print(entry["classification"], "->", entry["item"], entry.get("new_name") or "")
# renamed    -> Customer ID   Client ID
# unchanged  -> Order Date
# removed    -> Unit Price
# added      -> Grand Total
```

Each result record is an `ItemComparisonResult` TypedDict:

| Field | Type | Description |
|---|---|---|
| `item` | `SemanticItem` | The original item (or the new item for `added`). |
| `classification` | `ItemComparisonClassification` | One of `unchanged`, `renamed`, `removed`, `added`. |
| `new_name` | `str \| None` | Populated only for `renamed` items. |

## `SemanticItem`

Both functions accept items as plain strings or as `ComparableNamedItem` dicts:

```python
SemanticItem = str | ComparableNamedItem

# ComparableNamedItem shape:
# {
#     "name": str,          # required
#     "description": str,   # optional -- extra context for the model
# }
```

## Local dev (Windows)

From `packages/python-semantic-match`, activate the package venv and run tests:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pytest tests/ -v
```

## Notes

- Package name for `pip install` is `mightydatainc-semantic-match`.
- Python import package is `mightydatainc_semantic_match`.
- Requires Python 3.13+ and `mightydatainc-gpt-conversation>=1.3.2`.
