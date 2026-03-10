import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';

import OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ocrStructuredFields } from '../src/ocrStructuredFields.js';
import { ocrTablesFromPDFs } from '../src/ocrTablesFromPDF.js';
import { ocrTablesFromPngPages } from '../src/ocrTableData.js';
import { renderPdfPagesToPngBuffers } from '../src/pdfPagesToPngs.js';
import { OcrTable } from '../src/records.js';

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock('../src/pdfPagesToPngs.js', () => ({
  renderPdfPagesToPngBuffers: vi.fn(),
}));

vi.mock('../src/ocrTableData.js', () => ({
  ocrTablesFromPngPages: vi.fn(),
  ocrTranscribeTableFromPages: vi.fn(),
}));

vi.mock('../src/ocrStructuredFields.js', () => ({
  ocrStructuredFields: vi.fn(),
}));

const makeStats = (kind: 'file' | 'directory' | 'other') => {
  return {
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'directory',
  };
};

describe('ocrTablesFromPDF', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(renderPdfPagesToPngBuffers).mockResolvedValue([
      Buffer.from('png'),
    ]);

    const fakeTable: OcrTable = {
      name: 'Table 1',
      description: 'desc',
      columns: ['colA'],
      page_start: 1,
      page_end: 1,
      data: [{ colA: 'value' }],
      aggregations: '',
      notes: '',
    };

    vi.mocked(ocrTablesFromPngPages).mockResolvedValue([fakeTable]);
    vi.mocked(ocrStructuredFields).mockResolvedValue({ source: 'test' });
  });

  it('processes file inputs directly', async () => {
    vi.mocked(stat).mockResolvedValue(makeStats('file') as never);
    const progressCallback = vi.fn();

    const result = await ocrTablesFromPDFs(
      {} as OpenAI,
      ['docs/invoice-1.pdf'],
      { invoiceId: 'Invoice ID' },
      undefined,
      progressCallback
    );

    expect(Object.keys(result)).toEqual(['docs/invoice-1.pdf']);
    expect(vi.mocked(renderPdfPagesToPngBuffers)).toHaveBeenCalledWith(
      'docs/invoice-1.pdf'
    );
    expect(progressCallback).toHaveBeenCalledTimes(1);
    expect(progressCallback).toHaveBeenCalledWith(1, 0);
    expect(vi.mocked(readdir)).not.toHaveBeenCalled();
  });

  it('recursively discovers PDFs from nested directories', async () => {
    const batchDir = path.normalize('docs/batch');
    const nestedDir = path.normalize('docs/batch/nested-dir');
    const progressCallback = vi.fn();

    vi.mocked(stat).mockImplementation(async (targetPath) => {
      const normalizedPath = path.normalize(String(targetPath));
      if (normalizedPath === batchDir || normalizedPath === nestedDir) {
        return makeStats('directory') as never;
      }
      return makeStats('file') as never;
    });

    vi.mocked(readdir).mockImplementation(async (targetPath) => {
      const normalizedPath = path.normalize(String(targetPath));

      if (normalizedPath === batchDir) {
        return [
          { name: 'z-last.pdf', isFile: () => true, isDirectory: () => false },
          { name: 'ignore.txt', isFile: () => true, isDirectory: () => false },
          { name: 'A-first.PDF', isFile: () => true, isDirectory: () => false },
          {
            name: 'nested-dir',
            isFile: () => false,
            isDirectory: () => true,
          },
        ] as never;
      }

      if (normalizedPath === nestedDir) {
        return [
          {
            name: 'nested-report.pdf',
            isFile: () => true,
            isDirectory: () => false,
          },
          {
            name: 'notes.txt',
            isFile: () => true,
            isDirectory: () => false,
          },
        ] as never;
      }

      return [] as never;
    });

    const result = await ocrTablesFromPDFs(
      {} as OpenAI,
      ['docs/batch'],
      {
        invoiceId: 'Invoice ID',
      },
      undefined,
      progressCallback
    );

    const firstPdf = path.join('docs/batch', 'A-first.PDF');
    const secondPdf = path.join('docs/batch', 'z-last.pdf');
    const nestedPdf = path.join('docs/batch/nested-dir', 'nested-report.pdf');

    expect(vi.mocked(renderPdfPagesToPngBuffers)).toHaveBeenNthCalledWith(
      1,
      firstPdf
    );
    expect(vi.mocked(renderPdfPagesToPngBuffers)).toHaveBeenNthCalledWith(
      2,
      secondPdf
    );
    expect(vi.mocked(renderPdfPagesToPngBuffers)).toHaveBeenNthCalledWith(
      3,
      nestedPdf
    );

    expect(progressCallback).toHaveBeenCalledTimes(3);
    expect(progressCallback).toHaveBeenNthCalledWith(1, 1, 2);
    expect(progressCallback).toHaveBeenNthCalledWith(2, 2, 1);
    expect(progressCallback).toHaveBeenNthCalledWith(3, 3, 0);

    expect(Object.keys(result)).toEqual([firstPdf, secondPdf, nestedPdf]);
  });

  it('throws for unsupported paths that are neither files nor directories', async () => {
    vi.mocked(stat).mockResolvedValue(makeStats('other') as never);

    await expect(
      ocrTablesFromPDFs({} as OpenAI, ['docs/unknown'], {
        invoiceId: 'Invoice ID',
      })
    ).rejects.toThrow('Expected file or directory path, got: docs/unknown');
  });
});
