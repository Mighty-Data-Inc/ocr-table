import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OpenAI } from 'openai';
import { describe, expect, it } from 'vitest';

import { ocrStructuredFields } from '../src/ocrStructuredFields.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

/**
 * Loads PNG buffers for a numbered sequence of fixture files.
 *
 * Pass a pattern containing a single `#` character as the page-number
 * placeholder, e.g. `"candidate-eval-pg#"`. The function substitutes `#`
 * with 1, 2, 3, … in order, loading each file as long as
 * `<FIXTURES_DIR>/<pattern-with-number>.png` exists, then stops at the
 * first missing file and returns the collected buffers.
 */
function loadFixturePngs(pattern: string): Buffer[] {
  const buffers: Buffer[] = [];
  for (let i = 1; ; i++) {
    const filename = pattern.replace('#', String(i)) + '.png';
    const filePath = path.join(FIXTURES_DIR, filename);
    if (!existsSync(filePath)) break;
    buffers.push(readFileSync(filePath));
  }
  return buffers;
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
if (!OPENAI_API_KEY) {
  throw new Error(
    'OPENAI_API_KEY is required for live API tests. Configure your test environment to provide it.'
  );
}

const SCHOOL_SUPPLIES_VALUES_EXPECTED_EXPLICIT = {
  'School Name': 'Sampleville Elementary',
  District: 'North River Unified School District',
  Principal: 'Dr. Mira Patel',
  'School Year': '2025-2026',
  'Billing Month': 'February 2026',
  Vendor: 'BrightPath Classroom Supply Co.',
  'Invoice Number': 'BOS-SE-2026-02-1147',
  'Payment Terms': 'Net 30 days',
};

const SCHOOL_SUPPLIES_VALUES_EXPECTED_IMPLICIT = {
  'Contact Department': 'School Operations Office',
  'Contact Phone Number': '(555) 010-2044',
};

const SCHOOL_SUPPLIES_VALUES_EXPECTED_ALL = {
  ...SCHOOL_SUPPLIES_VALUES_EXPECTED_EXPLICIT,
  ...SCHOOL_SUPPLIES_VALUES_EXPECTED_IMPLICIT,
};

const SCHOOL_SUPPLIES_FIELDS_QUERY_EXPLICIT = {
  'School Name': '',
  District: '',
  Principal: '',
  'School Year': '',
  'Billing Month': '',
  Vendor: '',
  'Invoice Number': '',
  'Payment Terms': '',
};

const SCHOOL_SUPPLIES_FIELDS_QUERY_IMPLICIT = {
  'Contact Department': `What's the full title-cased name of the school department to contact for questions?`,
  'Contact Phone Number': '',
};

const SCHOOL_SUPPLIES_FIELDS_QUERY_ALL = {
  ...SCHOOL_SUPPLIES_FIELDS_QUERY_EXPLICIT,
  ...SCHOOL_SUPPLIES_FIELDS_QUERY_IMPLICIT,
};

const createClient = (): OpenAI =>
  new OpenAI({
    apiKey: OPENAI_API_KEY,
  });

describe('ocrStructuredFields (live API)', () => {
  it('can extract explicitly labeled fields from the start of a document', async () => {
    const openaiClient = createClient();
    const pagesAsPngBuffers = loadFixturePngs(
      'school-supplies-BOS-11pt-page-#'
    );

    const extractedFields = await ocrStructuredFields(
      openaiClient,
      pagesAsPngBuffers,
      SCHOOL_SUPPLIES_FIELDS_QUERY_EXPLICIT
    );

    expect(extractedFields).toEqual(SCHOOL_SUPPLIES_VALUES_EXPECTED_EXPLICIT);
  }, 180000);

  it('can extract implied fields from late content in a document', async () => {
    const openaiClient = createClient();
    const pagesAsPngBuffers = loadFixturePngs(
      'school-supplies-BOS-11pt-page-#'
    );

    const extractedFields = await ocrStructuredFields(
      openaiClient,
      pagesAsPngBuffers,
      SCHOOL_SUPPLIES_FIELDS_QUERY_IMPLICIT
    );

    expect(extractedFields).toEqual(SCHOOL_SUPPLIES_VALUES_EXPECTED_IMPLICIT);
  }, 180000);

  it('can extract all fields from a document', async () => {
    const openaiClient = createClient();
    const pagesAsPngBuffers = loadFixturePngs(
      'school-supplies-BOS-11pt-page-#'
    );

    const extractedFields = await ocrStructuredFields(
      openaiClient,
      pagesAsPngBuffers,
      SCHOOL_SUPPLIES_FIELDS_QUERY_ALL
    );

    expect(extractedFields).toEqual(SCHOOL_SUPPLIES_VALUES_EXPECTED_ALL);
  }, 180000);

  it('obeys additional instructions', async () => {
    const openaiClient = createClient();
    const pagesAsPngBuffers = loadFixturePngs(
      'school-supplies-BOS-11pt-page-#'
    );

    const extractedFields = await ocrStructuredFields(
      openaiClient,
      pagesAsPngBuffers,
      SCHOOL_SUPPLIES_FIELDS_QUERY_ALL,
      `The phone number is a misprint. It's actually 555-818-2044. Not 010.`
    );

    expect(extractedFields).toEqual({
      ...SCHOOL_SUPPLIES_VALUES_EXPECTED_ALL,
      'Contact Phone Number': '555-818-2044',
    });
  }, 180000);
});
