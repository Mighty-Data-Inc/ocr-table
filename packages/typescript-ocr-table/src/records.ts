/**
 * Represents a table extracted from a document via OCR.
 * Contains metadata about the table along with its structured data.
 */
export interface OcrExtractedTable {
  name: string;
  description: string;
  columns: string[];
  page_start: number;
  page_end: number;
  data: Array<Record<string, string>>;
  aggregations: string;
  notes: string;
}

/**
 * Represents all tables extracted from a single file.
 * Links the source file path to its extracted tables and optional metadata.
 */
export interface OcrTablesFromFile {
  file: string;
  metadata?: Record<string, string>;
  tables: OcrExtractedTable[];
}

/**
 * Maps file paths to their OCR extraction results.
 * Used for batch processing multiple PDF files and organizing their extracted table data.
 */
export interface OcrMultiFilesTableExtraction {
  [filePath: string]: OcrTablesFromFile;
}

/**
 * A utility function to extract all metadata from the OCR extraction results.
 * @param extractedData - The OCR extraction results from multiple files
 * @param includeEmpty - Whether to include files with empty metadata
 * @returns A mapping of file paths to their corresponding metadata records
 */
export const getAllOcrExtractedMetadatas = (
  extractedData: OcrMultiFilesTableExtraction,
  includeEmpty: boolean = false
): Record<string, Record<string, string>> => {
  const retval: Record<string, Record<string, string>> = {};
  for (const [filePath, ocrData] of Object.entries(extractedData)) {
    if (!includeEmpty && (!ocrData.metadata || Object.keys(ocrData.metadata).length === 0)) {
      continue;
    }
    retval[filePath] = ocrData.metadata || {};
  }
  return retval;
};