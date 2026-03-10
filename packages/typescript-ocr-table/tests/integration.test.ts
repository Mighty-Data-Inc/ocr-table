import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OpenAI } from 'openai';
import { describe, expect, it } from 'vitest';

import { ocrTablesFromPDFs } from '../src/ocrTablesFromPDF.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
if (!OPENAI_API_KEY) {
  throw new Error(
    'OPENAI_API_KEY is required for live API tests. Configure your test environment to provide it.'
  );
}

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
      "Don't include the word 'Magazine' in the name of the magazine."
    );

    console.log(JSON.stringify(ocrTableDataFromFiles, null, 2));
  }, 1200000);
});
