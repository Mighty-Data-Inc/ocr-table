# @mightydatainc/semantic-match

AI-powered semantic matching and comparison of named item lists, powered by OpenAI. Resolve a user-supplied string to a canonical item in a list -- even when names differ -- and diff two versions of a list to classify each item as unchanged, renamed, removed, or added.

## Installation

```bash
npm install @mightydatainc/semantic-match
```

## Quick Start

### `findSemanticMatch`

Find which item in a list best matches a query string, even if the names are different:

```ts
import OpenAI from 'openai';
import { findSemanticMatch } from '@mightydatainc/semantic-match';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const items = ['Customer ID', 'Order Date', 'Total Amount'];

const index = await findSemanticMatch(client, items, 'Client Identifier');
console.log(index);   // 0  ->  "Customer ID"

const index2 = await findSemanticMatch(client, items, 'Product Name');
console.log(index2);  // -1  ->  no match found
```

Items can also carry an optional `description` to give the model more context:

```ts
import { findSemanticMatch, SemanticItem } from '@mightydatainc/semantic-match';

const items: SemanticItem[] = [
  { name: 'MRR', description: 'Monthly Recurring Revenue' },
  { name: 'ARR', description: 'Annual Recurring Revenue' },
  { name: 'Churn Rate' },
];

const index = await findSemanticMatch(client, items, 'monthly subscription revenue');
console.log(index);   // 0  ->  "MRR"
```

An optional `explanation` string can be passed to give the model additional context:

```ts
const index = await findSemanticMatch(
  client,
  items,
  'monthly subscription revenue',
  'These are SaaS business metrics.'
);
```

Exact name matches (case-insensitive) are resolved locally without an API call.

### `compareItemLists`

Diff two versions of an item list and classify every item:

```ts
import { compareItemLists, ItemComparisonClassification } from '@mightydatainc/semantic-match';

const before = ['Customer ID', 'Order Date', 'Unit Price', 'Total Amount'];
const after  = ['Client ID',   'Order Date', 'Grand Total'];

const results = await compareItemLists(client, before, after);

for (const entry of results) {
  console.log(entry.classification, '->', entry.item, entry.newName ?? '');
}
// renamed    -> Customer ID   Client ID
// unchanged  -> Order Date
// removed    -> Unit Price
// added      -> Grand Total
```

Each result object is typed as `ItemComparisonResult`:

| Field | Type | Description |
|---|---|---|
| `item` | `SemanticItem` | The original item (or the new item for `added`). |
| `classification` | `ItemComparisonClassification` | One of `Unchanged`, `Renamed`, `Removed`, `Added`. |
| `newName` | `string \| undefined` | Populated only for `Renamed` items. |

## `SemanticItem`

Both functions accept items as plain strings or as objects with `name` and optional `description`:

```ts
type SemanticItem =
  | string
  | { name: string; description?: string };
```

## Local dev

From `packages/typescript-semantic-match`:

```bash
npm ci
npm test
npm run build
```

## Notes

- Package name for `npm install` is `@mightydatainc/semantic-match`.
- Requires `@mightydatainc/gpt-conversation >= 1.3.3`.
- All matching functions are `async` and return Promises.
