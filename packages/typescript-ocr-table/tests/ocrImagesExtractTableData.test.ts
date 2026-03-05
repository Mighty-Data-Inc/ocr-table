import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OpenAI } from 'openai';
import { describe, expect, it } from 'vitest';

import {
  ocrIdentifyTablesOnPage,
  ocrImagesExtractTableColumnHeaders,
  ocrImagesPopulateTableContents,
} from '../src/ocrImagesExtractTableData.js';
import { OcrExtractedTable } from '../src/records.js';

import wildernessProvisionsTable8 from './fixtures/wilderness-provisions-table-8.json' with { type: 'json' };
import wildernessProvisionsTable7 from './fixtures/wilderness-provisions-table-7.json' with { type: 'json' };
import schoolSuppliesJonahReed from './fixtures/school-supplies-BOS-JonahReed.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
if (!OPENAI_API_KEY) {
  throw new Error(
    'OPENAI_API_KEY is required for ocrIdentifyTablesOnPage live API tests. Configure your test environment to provide it.'
  );
}

const createClient = (): OpenAI =>
  new OpenAI({
    apiKey: OPENAI_API_KEY,
  });

// Live OCR can occasionally confuse visually similar characters (for example, "5" vs "S")
// in room labels. We provide this hint so strict exact-name assertions test table-identification
// behavior rather than avoidable room-code transcription ambiguity.
const ADDITIONAL_INSTRUCTIONS = `
Classroom numbers are in <number><letter> format, e.g. A3, D9, etc.
When performing OCR, sometimes a "5" will look like an "S" or a "2" like a "Z",
and vice versa. However, when you see a classroom number, e.g. "Room 2D",
you must transcribe it as <number><letter>.
`;

describe('ocrIdentifyTablesOnPage (live API)', () => {
  it('can detect two tables on a page when that is all that is on the page', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageThreePngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-11pt-page-3.png'
    );
    const pageThreeBuffer = await readFile(pageThreePngPath);

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      pageThreeBuffer,
      undefined,
      undefined,
      undefined,
      ADDITIONAL_INSTRUCTIONS
    );

    expect(tables).toHaveLength(2);
    expect(tables[0]?.name).toBe(
      'Classroom Purchases - Ms. Tessa Monroe (Room 2D)'
    );
    expect(tables[1]?.name).toBe(
      'Classroom Purchases - Mr. Omar Whitfield (Room 1A)'
    );
  }, 180000);

  it('can detect two table names even when there is other text on the page', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageOnePngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-11pt-page-1.png'
    );
    const pageOneBuffer = await readFile(pageOnePngPath);

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      pageOneBuffer,
      undefined,
      undefined,
      undefined,
      ADDITIONAL_INSTRUCTIONS
    );

    expect(tables).toHaveLength(2);
    expect(tables[0]?.name).toBe(
      'Classroom Purchases - Ms. Elena Alvarez (Room 3A)'
    );
    expect(tables[1]?.name).toBe(
      'Classroom Purchases - Mr. Jonah Reed (Room 4B)'
    );
  }, 180000);

  it('detects one embedded table within dense two-column prose', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const wildernessProvisionsPngPath = path.join(
      fixturesDir,
      'wilderness-provisions.png'
    );
    const wildernessProvisionsBuffer = await readFile(
      wildernessProvisionsPngPath
    );

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      wildernessProvisionsBuffer
    );

    expect(tables).toHaveLength(1);
    expect(tables[0]?.name).toBe(
      'Table 7: Weekly Provisions by Terrain (Per Adventurer)'
    );
  }, 180000);

  it('detects two embedded tables within dense two-column prose', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const wildernessProvisionsPngPath = path.join(
      fixturesDir,
      'wilderness-provisions-2table.png'
    );
    const wildernessProvisionsBuffer = await readFile(
      wildernessProvisionsPngPath
    );

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      wildernessProvisionsBuffer,
      undefined,
      undefined,
      undefined,
      `When you list tables, sort your tables in numerical order ` +
        `-- e.g. "Table 2", then "Table 3", then "Table 4", etc.`
    );

    expect(tables).toHaveLength(2);
    expect(tables[0]?.name).toBe(
      'Table 7: Weekly Provisions by Terrain (Per Adventurer)'
    );
    expect(tables[1]?.name).toBe('Table 8: March Rate by Load Class');
  }, 180000);

  it('can read an orphaned table name', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageThreePngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-14pt-page-3.png'
    );
    const pageFourPngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-14pt-page-4.png'
    );
    const pageThreeBuffer = await readFile(pageThreePngPath);
    const pageFourBuffer = await readFile(pageFourPngPath);

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      pageThreeBuffer,
      undefined,
      undefined,
      undefined,
      ADDITIONAL_INSTRUCTIONS,
      pageFourBuffer
    );

    expect(tables).toHaveLength(2);
    expect(tables[0]?.name).toBe(
      'Classroom Purchases - Ms. Priya Nandakumar (Room 5C)'
    );
    expect(tables[1]?.name).toBe(
      'Classroom Purchases - Ms. Tessa Monroe (Room 2D)'
    );
  }, 180000);

  it('does not get distracted by next-page content', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageOnePngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-14pt-page-1.png'
    );
    const pageTwoPngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-14pt-page-2.png'
    );
    const pageOneBuffer = await readFile(pageOnePngPath);
    const pageTwoBuffer = await readFile(pageTwoPngPath);

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      pageOneBuffer,
      undefined,
      undefined,
      undefined,
      ADDITIONAL_INSTRUCTIONS,
      pageTwoBuffer
    );

    expect(tables).toHaveLength(1);
    expect(tables[0]?.name).toBe(
      'Classroom Purchases - Ms. Elena Alvarez (Room 3A)'
    );
  }, 180000);

  it('ignores top-of-page overrun rows when previous page ended with a table', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageTwoPngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-11pt-page-2.png'
    );
    const pageTwoBuffer = await readFile(pageTwoPngPath);

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      pageTwoBuffer,
      undefined,
      true,
      undefined,
      ADDITIONAL_INSTRUCTIONS
    );

    expect(tables).toHaveLength(1);
    expect(tables[0]?.name).toBe(
      'Classroom Purchases - Ms. Priya Nandakumar (Room 5C)'
    );
  }, 180000);

  it('treats top-of-page rows as a new table when previous page did not end with a table', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageTwoPngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-11pt-page-2.png'
    );
    const pageTwoBuffer = await readFile(pageTwoPngPath);

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      pageTwoBuffer,
      undefined,
      false,
      undefined,
      ADDITIONAL_INSTRUCTIONS
    );

    expect(tables).toHaveLength(2);
    expect(tables[1]?.name).toBe(
      'Classroom Purchases - Ms. Priya Nandakumar (Room 5C)'
    );
  }, 180000);

  it('uses first-table anchor to isolate the intended table even when prior-page flag says false', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageTwoPngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-11pt-page-2.png'
    );
    const pageTwoBuffer = await readFile(pageTwoPngPath);

    /*
      This test intentionally creates a contradictory setup to verify parameter priority:

      - The page starts with overrun rows from a table that began on the previous page.
      - We explicitly set didPreviousPageEndWithTable = false, which would normally bias
        the model toward treating top-of-page rows as a NEW table.
      - We also provide nameOfFirstTableOnPage = "Classroom Purchases - Ms. Priya Nandakumar (Room 5C)",
        which is an explicit anchor telling the model where the first *new* table on this page starts.

      Expected behavior:
      The explicit first-table anchor should win over the less reliable prior-page heuristic.
      Therefore, the overrun rows at the top should be ignored and only Priya's table should
      be returned.
    */
    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      pageTwoBuffer,
      undefined,
      false,
      'Classroom Purchases - Ms. Priya Nandakumar (Room 5C)',
      ADDITIONAL_INSTRUCTIONS
    );

    expect(tables).toHaveLength(1);
    expect(tables[0]?.name).toBe(
      'Classroom Purchases - Ms. Priya Nandakumar (Room 5C)'
    );
  }, 180000);

  it('obeys additionalInstructions for guidance in interpreting visual text', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageTwoPngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-11pt-page-2.png'
    );
    const pageTwoBuffer = await readFile(pageTwoPngPath);

    const lettersOnlyRoomInstructions =
      'Room numbers are always two-letter codes, e.g. ND or EE, and explicitly NOT numeric.';

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      pageTwoBuffer,
      undefined,
      true,
      undefined,
      lettersOnlyRoomInstructions
    );

    expect(tables).toHaveLength(1);
    expect(tables[0]?.name).toBe(
      'Classroom Purchases - Ms. Priya Nandakumar (Room SC)'
    );
  }, 180000);

  it('returns no tables for an image that contains no document text', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const phoenixPngPath = path.join(fixturesDir, 'phoenix.png');
    const phoenixBuffer = await readFile(phoenixPngPath);

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      phoenixBuffer,
      undefined,
      undefined,
      undefined,
      ADDITIONAL_INSTRUCTIONS
    );

    expect(tables).toEqual([]);
  }, 180000);

  it('returns no tables for non-tabular text content', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const dirtyWisconsinPngPath = path.join(fixturesDir, 'dirty-wisconsin.png');
    const dirtyWisconsinBuffer = await readFile(dirtyWisconsinPngPath);

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      dirtyWisconsinBuffer,
      undefined,
      undefined,
      undefined,
      ADDITIONAL_INSTRUCTIONS
    );

    expect(tables).toEqual([]);
  }, 180000);

  it('returns no tables for dense prose text content', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const annaKareninaPngPath = path.join(fixturesDir, 'annakarenina.png');
    const annaKareninaBuffer = await readFile(annaKareninaPngPath);

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      annaKareninaBuffer,
      undefined,
      undefined,
      undefined,
      ADDITIONAL_INSTRUCTIONS
    );

    expect(tables).toEqual([]);
  }, 180000);
});

describe('ocrImagesExtractTableColumnHeaders (live API)', () => {
  it('returns the correct column headers for a straightforward table', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageOnePngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-11pt-page-1.png'
    );
    const pageOneBuffer = await readFile(pageOnePngPath);

    const columns = await ocrImagesExtractTableColumnHeaders(
      createClient(),
      'Classroom Purchases - Ms. Elena Alvarez (Room 3A)',
      pageOneBuffer
    );

    expect(columns).toEqual([
      'Item Name',
      'Item Description',
      'Quantity',
      'Unit Price (USD)',
      'Line Total (USD)',
    ]);
  }, 180000);

  it('obeys additionalInstructions that exclude a specific column', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageOnePngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-11pt-page-1.png'
    );
    const pageOneBuffer = await readFile(pageOnePngPath);

    const columns = await ocrImagesExtractTableColumnHeaders(
      createClient(),
      'Classroom Purchases - Ms. Elena Alvarez (Room 3A)',
      pageOneBuffer,
      `Do not include the "Item Description" column in your output. ` +
        `The item descriptions are too verbose and confusing -- ` +
        `they do more harm than good. Omit them from your responses.`
    );

    expect(columns).toEqual([
      'Item Name',
      'Quantity',
      'Unit Price (USD)',
      'Line Total (USD)',
    ]);
  }, 180000);

  it('returns correct column headers even when the table name is not specified exactly', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageOnePngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-11pt-page-1.png'
    );
    const pageOneBuffer = await readFile(pageOnePngPath);

    const columns = await ocrImagesExtractTableColumnHeaders(
      createClient(),
      'Ms. Alvarez (Room 3A) Classroom Purchases',
      pageOneBuffer
    );

    expect(columns).toEqual([
      'Item Name',
      'Item Description',
      'Quantity',
      'Unit Price (USD)',
      'Line Total (USD)',
    ]);
  }, 180000);

  it('is not confused by the presence of a next-page image', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageOnePngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-11pt-page-1.png'
    );
    const pageTwoPngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-11pt-page-2.png'
    );
    const pageOneBuffer = await readFile(pageOnePngPath);
    const pageTwoBuffer = await readFile(pageTwoPngPath);

    const columns = await ocrImagesExtractTableColumnHeaders(
      createClient(),
      'Classroom Purchases - Ms. Elena Alvarez (Room 3A)',
      pageOneBuffer,
      undefined,
      undefined,
      pageTwoBuffer
    );

    expect(columns).toEqual([
      'Item Name',
      'Item Description',
      'Quantity',
      'Unit Price (USD)',
      'Line Total (USD)',
    ]);
  }, 180000);

  it('can identify column headers for a table whose title is orphaned on the prior page', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageThreePngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-14pt-page-3.png'
    );
    const pageFourPngPath = path.join(
      fixturesDir,
      'school-supplies-BOS-14pt-page-4.png'
    );
    const pageThreeBuffer = await readFile(pageThreePngPath);
    const pageFourBuffer = await readFile(pageFourPngPath);

    const columns = await ocrImagesExtractTableColumnHeaders(
      createClient(),
      'Classroom Purchases - Ms. Tessa Monroe (Room 2D)',
      pageThreeBuffer,
      ADDITIONAL_INSTRUCTIONS,
      undefined,
      pageFourBuffer
    );

    expect(columns).toEqual([
      'Item Name',
      'Item Description',
      'Quantity',
      'Unit Price (USD)',
      'Line Total (USD)',
    ]);
  }, 180000);

  it('can identify column headers for a table embedded in dense prose', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const wildernessProvisionsPngPath = path.join(
      fixturesDir,
      'wilderness-provisions-2table.png'
    );
    const wildernessProvisionsBuffer = await readFile(
      wildernessProvisionsPngPath
    );

    const columns = await ocrImagesExtractTableColumnHeaders(
      createClient(),
      'Table 8: March Rate by Load Class',
      wildernessProvisionsBuffer
    );

    expect(columns).toEqual([
      'Load Class',
      'Typical Carried Weight (lb)',
      'Daily March Distance (miles)',
      'Fatigue Penalty',
    ]);
  }, 180000);

  it('can infer column names when the table has no explicit header row', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const noColumnNamesPngPath = path.join(
      fixturesDir,
      'nocolumnnames-school-supplies-BOS-14pt-page-5.png'
    );
    const noColumnNamesBuffer = await readFile(noColumnNamesPngPath);

    // This has the added benefit of also testing that additionalInstructions are
    // passed and followed.
    const columns = await ocrImagesExtractTableColumnHeaders(
      createClient(),
      'Classroom Purchases - Ms. Claire Donnelly (Room Kindergarten B)',
      noColumnNamesBuffer,
      `
If you cannot find explicit column headers in the table, use the following names,
applied as appropriate based on the content of each column:
- PriceTotal
- Quantity
- PricePerUnit
- Description
- Name
`
    );

    expect(columns).toEqual([
      'Name',
      'Description',
      'Quantity',
      'PricePerUnit',
      'PriceTotal',
    ]);
  }, 180000);
});

describe('ocrImagesPopulateTableContents (live API)', () => {
  it('populates data rows for a small, simple table', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const wildernessProvisionsPngPath = path.join(
      fixturesDir,
      'wilderness-provisions-2table.png'
    );
    const wildernessProvisionsBuffer = await readFile(
      wildernessProvisionsPngPath
    );

    const table: OcrExtractedTable = {
      name: 'Table 8: March Rate by Load Class',
      description: 'Daily march distance and fatigue penalty by load class.',
      columns: [
        'Load Class',
        'Typical Carried Weight (lb)',
        'Daily March Distance (miles)',
        'Fatigue Penalty',
      ],
      page_start: 1,
      page_end: 1,
      data: [],
      aggregations: '',
      notes: '',
    };

    await ocrImagesPopulateTableContents(createClient(), table, [
      wildernessProvisionsBuffer,
    ]);

    expect(table.data).toEqual(wildernessProvisionsTable8);
  }, 180000);

  it('populates data rows for a table that reaches the bottom of the only page', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const wildernessProvisionsPngPath = path.join(
      fixturesDir,
      'wilderness-provisions-2table.png'
    );
    const wildernessProvisionsBuffer = await readFile(
      wildernessProvisionsPngPath
    );

    const table: OcrExtractedTable = {
      name: 'Table 7: Weekly Provisions by Terrain (Per Adventurer)',
      description: 'Weekly provisions required per adventurer by terrain type.',
      columns: [
        'Terrain',
        'Water (gal/day)',
        'Rations (lb/day)',
        'Weekly Cost (gp)',
      ],
      page_start: 1,
      page_end: 1,
      data: [],
      aggregations: '',
      notes: '',
    };

    await ocrImagesPopulateTableContents(createClient(), table, [
      wildernessProvisionsBuffer,
    ]);

    expect(table.page_end).toBe(1);
    expect(table.data).toEqual(wildernessProvisionsTable7);
  }, 180000);

  it('stops transcribing a bottom-touching table if it does not continue on the next page', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const page1Buffer = await readFile(
      path.join(fixturesDir, 'wilderness-provisions-2table.png')
    );
    const page2Buffer = await readFile(
      path.join(fixturesDir, 'wilderness-provisions-2table-pg2.png')
    );

    const table: OcrExtractedTable = {
      name: 'Table 7: Weekly Provisions by Terrain (Per Adventurer)',
      description: 'Weekly provisions required per adventurer by terrain type.',
      columns: [
        'Terrain',
        'Water (gal/day)',
        'Rations (lb/day)',
        'Weekly Cost (gp)',
      ],
      page_start: 1,
      page_end: 1,
      data: [],
      aggregations: '',
      notes: '',
    };

    await ocrImagesPopulateTableContents(createClient(), table, [
      page1Buffer,
      page2Buffer,
    ]);

    expect(table.page_end).toBe(1);
    expect(table.data).toEqual(wildernessProvisionsTable7);
  }, 180000);

  it('reads a table that starts and ends on a middle page', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageBuffers = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) =>
        readFile(
          path.join(fixturesDir, `school-supplies-BOS-14pt-page-${n}.png`)
        )
      )
    );

    const table: OcrExtractedTable = {
      name: 'Classroom Purchases - Mr. Jonah Reed (Room 4B)',
      description: "School supply purchases for Mr. Jonah Reed's classroom.",
      columns: [
        'Item Name',
        'Item Description',
        'Quantity',
        'Unit Price (USD)',
        'Line Total (USD)',
      ],
      page_start: 2,
      page_end: 2,
      data: [],
      aggregations: '',
      notes: '',
    };

    await ocrImagesPopulateTableContents(
      createClient(),
      table,
      pageBuffers,
      ADDITIONAL_INSTRUCTIONS
    );

    expect(table.page_end).toBe(2);
    expect(table.data).toEqual(schoolSuppliesJonahReed);
  }, 180000);
});
