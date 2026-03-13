import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { renderPdfPagesToPngBuffers } from './pdfPagesToPngs.js';
import {
  OcrMultiFilesTableExtraction,
  OcrTable,
  OcrTablesFromFile,
} from './records.js';
import {
  ocrTablesFromPngPages,
  ocrTranscribeTableFromPages,
} from './ocrTableData.js';
import { ocrStructuredFields } from './ocrStructuredFields.js';

/**
 * Processes a single PDF file into table rows and structured metadata.
 *
 * The PDF is first rendered to PNG page buffers, then table data and
 * field-level metadata are extracted from those page images.
 *
 * @param aiClient AI client used for OCR/transcription requests.
 * @param pdfPath Absolute or relative path to the PDF file to process.
 * @param fieldsToExtract Field map where each key is the output field name
 * and each value describes what should be extracted.
 * @param additionalInstructions Optional extra OCR guidance applied to both
 * table extraction and structured field extraction.
 * @returns A single file result containing the source file path, extracted
 * tables, and extracted metadata.
 */
const _ocrTablesFromPDF_singleFile = async (
  aiClient: any,
  pdfPath: string,
  fieldsToExtract: Record<string, string>,
  additionalInstructions?: string
): Promise<OcrTablesFromFile> => {
  const pagesAsPngBuffers = await renderPdfPagesToPngBuffers(pdfPath);
  const extractedTables: OcrTable[] = await ocrTablesFromPngPages(
    aiClient,
    pagesAsPngBuffers,
    additionalInstructions
  );

  const metadataFromFile = await ocrStructuredFields(
    aiClient,
    pagesAsPngBuffers,
    fieldsToExtract,
    additionalInstructions
  );

  const retval: OcrTablesFromFile = {
    file: pdfPath,
    tables: extractedTables,
    metadata: metadataFromFile,
  };
  return retval;
};

export type OcrTablesFromPDFsProgressCallback = (
  filesDone: number,
  filesRemaining: number
) => void;

const _discoverPdfFiles = async (
  pdfPaths: string | string[]
): Promise<string[]> => {
  const pdfFileQueue = Array.isArray(pdfPaths) ? [...pdfPaths] : [pdfPaths];
  const discoveredPdfFiles: string[] = [];

  while (pdfFileQueue.length > 0) {
    const pdfPath = pdfFileQueue.shift()!;
    const pathStats = await stat(pdfPath);

    if (pathStats.isFile()) {
      discoveredPdfFiles.push(pdfPath);
      continue;
    }

    if (pathStats.isDirectory()) {
      const entries = await readdir(pdfPath, { withFileTypes: true });
      const nextQueueEntries = entries
        .filter(
          (entry) =>
            entry.isDirectory() ||
            (entry.isFile() && /\.pdf$/i.test(entry.name))
        )
        .map((entry) => path.join(pdfPath, entry.name))
        .sort((left, right) => left.localeCompare(right));

      pdfFileQueue.push(...nextQueueEntries);
      continue;
    }

    throw new Error(`Expected file or directory path, got: ${pdfPath}`);
  }

  return discoveredPdfFiles;
};

export async function ocrTablesFromPDFs(
  aiClient: any,
  pdfPaths: string | string[],
  fieldsToExtract: Record<string, string>,
  additionalInstructions?: string,
  progressCallback?: OcrTablesFromPDFsProgressCallback
): Promise<OcrMultiFilesTableExtraction> {
  const discoveredPdfFiles = await _discoverPdfFiles(pdfPaths);
  const results: OcrMultiFilesTableExtraction = {};
  const totalFiles = discoveredPdfFiles.length;
  let filesDone = 0;

  for (const pdfPath of discoveredPdfFiles) {
    const resultForFile = await _ocrTablesFromPDF_singleFile(
      aiClient,
      pdfPath,
      fieldsToExtract,
      additionalInstructions
    );
    results[pdfPath] = resultForFile;

    filesDone += 1;
    progressCallback?.(filesDone, totalFiles - filesDone);
  }

  const retval: OcrMultiFilesTableExtraction = results;
  return retval;
}
