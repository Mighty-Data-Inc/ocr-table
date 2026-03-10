import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OpenAI } from 'openai';
import { describe, expect, it } from 'vitest';

import { ocrTablesFromPDFs } from '../src/ocrTablesFromPDF.js';

import readingOcrExpectedResults from './fixtures/page_turner_magazine/results.json' with { type: 'json' };

// The expected results is a dict with two keys.
// One of them ends with "autumn_reading-Page_Turner.pdf" and the other ends with "summer_reading-Page_Turner.pdf".
// Extract them.
const autumnExpectedResults = Object.values(readingOcrExpectedResults).find(
  (result) => result.file.endsWith('autumn_reading-Page_Turner.pdf')
);
const summerExpectedResults = Object.values(readingOcrExpectedResults).find(
  (result) => result.file.endsWith('summer_reading-Page_Turner.pdf')
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
if (!OPENAI_API_KEY) {
  throw new Error(
    'OPENAI_API_KEY is required for live API tests. Configure your test environment to provide it.'
  );
}

const ADDIIONAL_INSTRUCTIONS_NO_EXTRA_CHARACTERS = `
FORMATTING INSTRUCTIONS:
Emit absolutely NO non-typeable characters -- this includes em-dashes, pretty quotes,
fancy apostrophes, non-breaking spaces, or any other characters that would not be produced 
if a human were typing on a standard keyboard. Your output is being matched against
expected values using strict equality, so if you emit any non-typeable characters,
your output will be considered incorrect.

WHITE SPACE INSTRUCTIONS:
When you use a double-dash separator in your output, always put a space on both sides of it, like this: " -- ".
EXAMPLE: YES: "I have a cat -- his name is Whiskers." NO: "I have a cat--his name is Whiskers."
`;

const ADDITIONAL_INSTRUCTIONS_FOR_PAGETURNER = `
The table names are the names of genres. They do not include the words
"Table" or "Part" or "Section" or anything like that. That may be how
they're shown in the source document, but that verbiage is just for organizing
the content visually for human readers. The structured data output should
just have the genre names as the table names.

When you list the column headers, write them in ALL CAPS.
That's the way the column headers appear in the source document, 
and we want to preserve that formatting in the structured data output.

The title of the magazine should be expressed in Title Case. The capitalization scheme
in the source document might be something else (e.g. all-caps), but the structured data output
should have the magazine title in Title Case.
`;

const createClient = (): OpenAI =>
  new OpenAI({
    apiKey: OPENAI_API_KEY,
  });

describe('ocrIdentifyTablesOnPage (live API)', () => {
  it('reads PDFs from a directory and returns their tables and metadata', async () => {
    const ocrTableDataFromFiles = await ocrTablesFromPDFs(
      createClient(),
      FIXTURES_DIR + '/page_turner_magazine',
      {
        'Magazine Name': '',
        Season: 'One of: "Spring"|"Summer"|"Fall"|"Winter"',
      },
      `
Don't include the word 'Magazine' in the name of the magazine.

${ADDIIONAL_INSTRUCTIONS_NO_EXTRA_CHARACTERS}

${ADDITIONAL_INSTRUCTIONS_FOR_PAGETURNER}
`
    );

    // Make sure there are two keys in the result, one for each PDF file in the directory
    const tableKeys = [...Object.keys(ocrTableDataFromFiles)];
    expect(tableKeys).toHaveLength(2);

    // Make sure one of them ends with "autumn_reading-Page_Turner.pdf" and the other ends with "summer_reading-Page_Turner.pdf"
    expect(
      tableKeys.some((key) => key.endsWith('autumn_reading-Page_Turner.pdf'))
    ).toBe(true);
    expect(
      tableKeys.some((key) => key.endsWith('summer_reading-Page_Turner.pdf'))
    ).toBe(true);

    // Grab the object at the key that ends with "autumn_reading-Page_Turner.pdf" from the observed results.
    // Clear out its notes and aggregations fields since that can be variable and isn't important for this test.
    const autumnResult = Object.values(ocrTableDataFromFiles).find((result) =>
      result.file.endsWith('autumn_reading-Page_Turner.pdf')
    );
    for (const table of autumnResult?.tables ?? []) {
      table.notes = '';
      table.aggregations = '';
    }
    expect(autumnResult?.metadata?.['Magazine Name']).toEqual('Page Turner');
    expect(autumnResult?.metadata?.['Season']).toEqual('Fall');
    expect(autumnResult?.tables?.[0]).toEqual(
      autumnExpectedResults?.tables?.[0]
    );
    expect(autumnResult?.tables?.[1]).toEqual(
      autumnExpectedResults?.tables?.[1]
    );
    expect(autumnResult?.tables?.[2]).toEqual(
      autumnExpectedResults?.tables?.[2]
    );

    // Now do the same for the summer results
    const summerResult = Object.values(ocrTableDataFromFiles).find((result) =>
      result.file.endsWith('summer_reading-Page_Turner.pdf')
    );
    for (const table of summerResult?.tables ?? []) {
      table.notes = '';
      table.aggregations = '';
    }
    expect(summerResult?.metadata?.['Magazine Name']).toEqual('Page Turner');
    expect(summerResult?.metadata?.['Season']).toEqual('Summer');
    expect(summerResult?.tables?.[0]).toEqual(
      summerExpectedResults?.tables?.[0]
    );
    expect(summerResult?.tables?.[1]).toEqual(
      summerExpectedResults?.tables?.[1]
    );
    expect(summerResult?.tables?.[2]).toEqual(
      summerExpectedResults?.tables?.[2]
    );
  }, 1500000);
});
