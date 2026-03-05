import { pdfToPng } from 'pdf-to-png-converter';

/**
 * Converts all pages of a PDF file into PNG image buffers.
 * Uses high-quality viewport scaling (3.0x) for improved OCR accuracy.
 *
 * @param pdfPath - Absolute path to the PDF file to convert
 * @returns Array of PNG image buffers, one per page
 * @throws Error if PDF cannot be read or converted
 */
export const renderPdfPagesToPngBuffers = async (pdfPath: string): Promise<Buffer[]> => {
  const pngPages = await pdfToPng(pdfPath, {
    disableFontFace: true,
    useSystemFonts: false,
    viewportScale: 3.0, // It keeps mistaking "1" for "4" at 2.0x; higher scale seems to fix that.
  });

  return pngPages
    .map(page => page.content)
    .filter((buffer): buffer is Buffer => buffer !== undefined);
};
