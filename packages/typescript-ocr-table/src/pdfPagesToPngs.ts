import { createRequire } from 'node:module';
import path from 'node:path';

import { pdfToPng } from 'pdf-to-png-converter';

// pdf-to-png-converter normalizes cMap/font paths using the platform separator,
// but PDF.js requires those factory URLs to end with a forward slash.
// On Windows, this produces a trailing backslash that PDF.js rejects.
if (process.platform === 'win32') {
  const requireCjs = createRequire(import.meta.url);
  const converterEntryPoint = requireCjs.resolve('pdf-to-png-converter');
  const converterDir = path.dirname(converterEntryPoint);
  const normalizePathModule = requireCjs(
    path.join(converterDir, 'normalizePath.js')
  );
  const normalizePathOriginalFunction = normalizePathModule.normalizePath;
  normalizePathModule.normalizePath = (p: string) =>
    normalizePathOriginalFunction(p).replace(/\\/g, '/');
}

/**
 * Converts all pages of a PDF file into PNG image buffers.
 * Uses high-quality viewport scaling (3.0x) for improved OCR accuracy.
 *
 * @param pdfPath - Absolute path to the PDF file to convert
 * @returns Array of PNG image buffers, one per page
 * @throws Error if PDF cannot be read or converted
 */
export const renderPdfPagesToPngBuffers = async (
  pdfPath: string
): Promise<Buffer[]> => {
  const pngPages = await pdfToPng(pdfPath, {
    disableFontFace: true,
    useSystemFonts: false,
    viewportScale: 3.0, // It keeps mistaking "1" for "4" at 2.0x; higher scale seems to fix that.
  });

  return pngPages
    .map((page) => page.content)
    .filter((buffer): buffer is Buffer => buffer !== undefined);
};
