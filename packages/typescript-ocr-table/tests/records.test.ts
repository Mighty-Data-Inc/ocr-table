import { describe, expect, it } from 'vitest';

import {
  getAllOcrExtractedMetadatas,
  type OcrMultiFilesTableExtraction,
} from '../src/records.js';

describe('getAllOcrExtractedMetadatas', () => {
  it('returns only files with non-empty metadata by default', () => {
    const extractedData: OcrMultiFilesTableExtraction = {
      '/docs/has-metadata.pdf': {
        file: '/docs/has-metadata.pdf',
        metadata: { invoiceId: 'INV-1001', vendor: 'ACME' },
        tables: [],
      },
      '/docs/empty-metadata.pdf': {
        file: '/docs/empty-metadata.pdf',
        metadata: {},
        tables: [],
      },
      '/docs/no-metadata.pdf': {
        file: '/docs/no-metadata.pdf',
        tables: [],
      },
    };

    const result = getAllOcrExtractedMetadatas(extractedData);

    expect(result).toEqual({
      '/docs/has-metadata.pdf': { invoiceId: 'INV-1001', vendor: 'ACME' },
    });
  });

  it('includes all files when includeEmpty is true', () => {
    const extractedData: OcrMultiFilesTableExtraction = {
      '/docs/has-metadata.pdf': {
        file: '/docs/has-metadata.pdf',
        metadata: { region: 'US' },
        tables: [],
      },
      '/docs/empty-metadata.pdf': {
        file: '/docs/empty-metadata.pdf',
        metadata: {},
        tables: [],
      },
      '/docs/no-metadata.pdf': {
        file: '/docs/no-metadata.pdf',
        tables: [],
      },
    };

    const result = getAllOcrExtractedMetadatas(extractedData, true);

    expect(result).toEqual({
      '/docs/has-metadata.pdf': { region: 'US' },
      '/docs/empty-metadata.pdf': {},
      '/docs/no-metadata.pdf': {},
    });
  });

  it('returns an empty object when input is empty', () => {
    const extractedData: OcrMultiFilesTableExtraction = {};

    const result = getAllOcrExtractedMetadatas(extractedData);

    expect(result).toEqual({});
  });
});
