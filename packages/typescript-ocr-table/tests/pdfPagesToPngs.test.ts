import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { renderPdfPagesToPngBuffers } from '../src/pdfPagesToPngs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('renderPdfPagesToPngBuffers', () => {
  it('matches fixture png outputs for each rendered page', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const fixturePdfPath = path.join(
      fixturesDir,
      'school-supplies-BOS-14pt.pdf'
    );

    await readFile(fixturePdfPath);

    const actualBuffers = await renderPdfPagesToPngBuffers(fixturePdfPath);

    const fixtureFiles = await readdir(fixturesDir);
    const expectedPngFiles = fixtureFiles
      .filter((fileName) =>
        /^school-supplies-BOS-14pt-page-\d+\.png$/i.test(fileName)
      )
      .sort((left, right) => {
        const leftPage = Number(left.match(/page-(\d+)\.png$/i)?.[1] ?? '0');
        const rightPage = Number(right.match(/page-(\d+)\.png$/i)?.[1] ?? '0');
        return leftPage - rightPage;
      });

    expect(expectedPngFiles.length).toBeGreaterThan(0);
    expect(actualBuffers.length).toBe(expectedPngFiles.length);

    for (const [index, fileName] of expectedPngFiles.entries()) {
      const expectedBuffer = await readFile(path.join(fixturesDir, fileName));
      expect(actualBuffers[index]?.equals(expectedBuffer)).toBe(true);
    }
  });
});
