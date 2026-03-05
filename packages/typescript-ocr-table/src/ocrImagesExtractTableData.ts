import { GPT_MODEL_VISION } from '@mightydatainc/gpt-conversation';
import {
  ConversationMessage,
  GptConversation,
} from '@mightydatainc/gpt-conversation';
import { JSONSchemaFormat } from '@mightydatainc/gpt-conversation';
import { OcrExtractedTable } from './records.js';
import { OpenAI } from 'openai';

/**
 * Initializes a `GptConversation` for OCR table detection on a single page.
 *
 * Seeds the conversation with a user message that includes the page image,
 * adds a base developer instruction to scan for tabular data, and optionally
 * appends caller-provided user instructions.
 *
 * @param openaiClient OpenAI client used by the conversation.
 * @param pagePngBuffer PNG bytes for the page being analyzed.
 * @param pagePositionInDocument Optional page position hint (`first`, `middle`, or `last`) used to tailor the initial page-context text.
 * @param additionalInstructions Optional user-level instructions to append to the conversation.
 * @returns A preconfigured `GptConversation` ready for OCR-table prompts/submissions.
 */
const _startOcrTableConversation = (
  openaiClient: OpenAI,
  pagePngBuffer: Buffer,
  pagePositionInDocument?: 'first' | 'last' | 'middle',
  additionalInstructions?: string,
  nextPagePngBuffer?: Buffer
): GptConversation => {
  const convo = new GptConversation([], {
    openaiClient,
    model: GPT_MODEL_VISION,
  });

  const messageText =
    pagePositionInDocument === 'first'
      ? `Here is the first page of a PDF document.`
      : pagePositionInDocument === 'last'
        ? `Here is the last page of a PDF document.`
        : pagePositionInDocument === 'middle'
          ? `Here is a from the middle of a PDF document.`
          : `Here is a page of a PDF document.`;

  const imgDataUrl = `data:image/png;base64,${pagePngBuffer.toString('base64')}`;
  convo.addImage('user', messageText, imgDataUrl);

  convo.addDeveloperMessage(`
We're scanning this page for **tabular data**.

Tabular data -- that is, data organized into tables -- is recognizable by a layout
where text is arranged in rows and columns.

Tables often have borders or shading to separate cells, but not always.

Tables are also often preceded by a title or heading that describes the content of the table.
This title or heading can be very helpful in identifying and understanding the table.

Another distinct telltale sign of a table is a row of column headers, which often appear
at the top of the table and provide context for the data below.

Tables can vary widely in their appearance and structure, so use your best judgment
to identify potential tables based on the overall layout and organization of the page.
`);

  if (nextPagePngBuffer) {
    const nextPageMessageText = `
In order to handle an edge case, we'll now also show you the *next* page of the document.

We are not directly interested in this next page, but on very rare occasions you might get
a table whose title appears at the bottom of the current page, but whose data (sometimes
including column headers, if this table has a header row) appears at the top of the next page.
When this happens, all you see at the bottom of the current page is some random orphaned title,
so you'll need to see the next page in order to see if that title is actually the title of a
table.
`;
    convo.addUserMessage(nextPageMessageText);

    const nextPageImgDataUrl = `data:image/png;base64,${nextPagePngBuffer.toString('base64')}`;
    convo.addImage(
      'user',
      'Here is the next page of the document.',
      nextPageImgDataUrl
    );
  }

  if (additionalInstructions) {
    convo.addUserMessage(additionalInstructions);
  }

  return convo;
};

/**
 * Identifies the tables visible on a single PDF page image.
 *
 * Starts a vision-enabled OCR conversation for the page, asks the model to
 * enumerate tables that start on this page, and requests structured JSON
 * containing table names and descriptions.
 *
 * @param openaiClient OpenAI client used to submit the OCR conversation.
 * @param pagePngBuffer PNG bytes for the page being analyzed.
 * @param pagePositionInDocument Optional page position hint (`first`, `middle`, or `last`) used for initial context.
 * @param nameOfFirstTableOnPage Optional table name to treat as the first table that starts on this page (used to ignore overflow rows from a prior page).
 * @param additionalInstructions Optional extra user instructions to guide table detection.
 * @param nextPagePngBuffer Optional PNG bytes for the next page, used to help identify orphaned table titles at the bottom of the current page.
 * @returns List of extracted-table objects for the page, populated from LLM output with names and descriptions plus default values for other fields.
 */
export const ocrIdentifyTablesOnPage = async (
  openaiClient: OpenAI,
  pagePngBuffer: Buffer,
  pagePositionInDocument?: 'first' | 'last' | 'middle',
  didPreviousPageEndWithTable?: boolean,
  nameOfFirstTableOnPage?: string,
  additionalInstructions?: string,
  nextPagePngBuffer?: Buffer
): Promise<OcrExtractedTable[]> => {
  const convo = _startOcrTableConversation(
    openaiClient,
    pagePngBuffer,
    pagePositionInDocument,
    additionalInstructions,
    nextPagePngBuffer
  );

  convo.addDeveloperMessage(`
Does this page contain any tables? Does it have just one table, or multiple tables?
What are the tables called? What fields do they contain? Discuss.

We are specifically only interested in tables that *start* on this page. If a table is a
continuation of a previous table that started on a previous page, we don't care about it.

Don't worry about actually parsing the data in the tables yet. 

**DO** pay attention to tables that *start* on this page, even if they continue
onto later pages. This includes tables that might have their title or header on this page
(perhaps at the bottom of the page, for example), but their data continues onto later pages.
`);

  if (didPreviousPageEndWithTable) {
    convo.addUserMessage(`
NOTE: The previous page ended with a table. It's possible that this table continues onto this page.
If you see some table data at the top of this page that doesn't have a table name, it might
be from the previous page. We only care about tables that *start* on this page, so you should
ignore any table that looks like it's continued from the previous page.
    `);
  } else {
    convo.addUserMessage(`
NOTE: As far as we know, the previous page (if there was one) did *not* end with a table. That
means that, if you see some table data at the top of this page, then it must be from a *new*
table that starts on this page. You should include it in your results.
    `);
  }

  if (nameOfFirstTableOnPage) {
    convo.addUserMessage(`
Start with the table that we're calling "${nameOfFirstTableOnPage}".
This is the first table that starts on the page.
If there are some table rows above this table, ignore them; they're from some prior table
that started on the previous page.
`);
  }

  await convo.submit(undefined, undefined, {
    jsonResponse: JSONSchemaFormat(
      {
        discussion: [
          String,
          `A thorough and detailed discussion about the tables you can see on this page, ` +
            `including their structure, titles, headers, content, and any relationships ` +
            `between them. This discussion is purely for your own benefit, to provide you ` +
            `with context to organize your thoughts before you start extracting data.`,
        ],
        discuss_does_page_start_with_untitled_table_data: [
          String,
          `Does the current page start with data from a table that doesn't have a title? ` +
            `If so, do you think it's from a table that started on a previous page, or is it ` +
            `a new table that starts on this page? Discuss.`,
        ],
        discuss_does_page_end_with_orphaned_title: [
          String,
          `Does the current page end with a title that doesn't seem to belong to any table ` +
            `on this page? If so, do you think it's the title of a table that continues on the ` +
            `next page? Discuss.`,
        ],
        discuss_tables_to_return: [
          String,
          `A discussion about which tables should be returned in the final output, ` +
            `taking into account our observations about the current page and any additional ` +
            `instructions we may be following.`,
        ],
        tables: [
          {
            name: [
              String,
              `The name, title, or heading of the table. If the table doesn't have ` +
                `any such name (or if the name is unclear or not present on this page), ` +
                `provide some descriptive identifier that will help us refer to this ` +
                `table later. If the table *does* have a title, write that title here ` +
                `*exactly* as it appears in the source image, without notes, annotations, ` +
                `or embellishments. There'll be a chance to provide additional context later; ` +
                `for now, we need the *exact* text if it's available.`,
            ],
            description: [
              String,
              `A brief description of the table's purpose.`,
            ],
          },
        ],
        orphaned_table_title: [
          String,
          `An orphaned table title is the title of a table whose title appears at the bottom ` +
            `of the page, but the table's contents are on the next page. If this page ends with ` +
            `an orphaned table title, please provide it here. If not, leave this field empty.`,
        ],
      },
      'ocr_enumerate_tables_on_page',
      `An identification of the tables that start this page. Can be empty ` +
        `if we have determined that there are no tables on this page.`
    ),
  });

  const identifiedTables = convo.getLastReplyDictField('tables', []) as Array<{
    name: string;
    description: string;
  }>;

  const tablesOnThisPage: OcrExtractedTable[] = identifiedTables.map(
    (table) => ({
      name: table.name,
      description: table.description,
      columns: [],
      page_start: 0,
      page_end: 0,
      data: [],
      aggregations: '',
      notes: '',
    })
  );

  const orphanedTableTitle = convo.getLastReplyDictField(
    'orphaned_table_title',
    ''
  ) as string;

  if (orphanedTableTitle) {
    // Check if the last table in the tablesOnThisPage array is already the orphaned table.
    if (
      tablesOnThisPage.length > 0 &&
      tablesOnThisPage[tablesOnThisPage.length - 1].name === orphanedTableTitle
    ) {
      // The last table is already the orphaned table, no need to add it again.
    } else {
      // Add the orphaned table title as a new table with no data.
      tablesOnThisPage.push({
        name: orphanedTableTitle,
        description: `NOTE: This table's title was orphaned on one page, but its contents are on a subsequent page.`,
        columns: [],
        page_start: 0,
        page_end: 0,
        data: [],
        aggregations: '',
        notes: '',
      });
    }
  }

  return tablesOnThisPage;
};

/**
 * Extracts the column headers from a specific named table in a page image.
 *
 * Starts an OCR conversation with the provided page image, narrows focus to
 * the given table by name/description, then asks the model to identify column
 * names — either by reading explicit header rows or by inferring them from the
 * cell content when no header row is present.
 *
 * @param openaiClient OpenAI client used to drive the conversation.
 * @param tableName Name or identifier of the table to target on the page.
 * @param pagePngBuffer PNG bytes of the document page containing the table.
 * @param additionalInstructions Optional caller-provided instructions to guide the OCR process.
 * @param tableDescription Optional description of the table to help the model locate it.
 * @param nextPagePngBuffer Optional PNG bytes of the following page, used when the table spans pages.
 * @returns Ordered array of column name strings extracted from the table.
 */
export const ocrImagesExtractTableColumnHeaders = async (
  openaiClient: OpenAI,
  tableName: string,
  pagePngBuffer: Buffer,
  additionalInstructions?: string,
  tableDescription?: string,
  nextPagePngBuffer?: Buffer
): Promise<string[]> => {
  const convo = _startOcrTableConversation(
    openaiClient,
    pagePngBuffer,
    undefined,
    additionalInstructions,
    nextPagePngBuffer
  );

  convo.addUserMessage(`
For the purposes of this work session, we'll be focusing specifically and
exclusively on the following table:
Name/Identifier: ${tableName}
Description: ${tableDescription || '(No description provided; what you see is what you get.)'}
`);

  convo.addUserMessage(`
What are the column names of this table? Please provide a list of the column names, 
based on any headers or other observable information. You'll be provided with an opportunity
to discuss your reasoning and observations, so please be sure to include a thorough discussion
of how you identified the column names, what clues you used, and any uncertainties or ambiguities
you had to navigate in determining the column names.

In most cases, discerning the column names should be straightforward, as they are often explicitly
stated in header rows. In such cases, simply extract the column names from the headers. Preserve
them exactly as they appear in the source, without adding any notes or annotations.

In the few cases in which a table does not explicitly state its column names, you'll need to infer
them based on the content of the cells, their formatting, or their position within the table.
Use your best judgment and reasoning skills to identify the most likely column names for this
table.
`);

  await convo.submit(undefined, undefined, {
    jsonResponse: JSONSchemaFormat(
      {
        discussion: [
          String,
          `A detailed discussion of how you are going to identify the column names. ` +
            `If it's straightforward, simply state that the column names are explicitly ` +
            `stated in the table headers. ` +
            `If you have to do any kind of inference or reasoning to determine the column names, ` +
            `talk through that reasoning process in detail here, discussing any uncertainties ` +
            `or ambiguities you have to navigate. ` +
            `This discussion is for your own benefit to help you organize your thoughts; ` +
            `it won't be included in the final output.`,
        ],
        column_names: [String],
      },
      'ocr_extract_columns_from_one_table',
      `Extract the column names from the table called "${tableName}".`
    ),
  });

  const columnNames = convo.getLastReplyDictField(
    'column_names',
    []
  ) as string[];
  return columnNames;
};

const _jsonSchemaForExtractingOneRowOfTableData = (
  columnNames: string[]
): any => {
  const schema: any = {
    type: 'object',
    properties: {
      discussion: {
        type: 'string',
        description:
          `A discussion of what data this row contains. State what this item is, ` +
          `what fields it contains, what values those fields contain, ` +
          `and any other relevant context or observations. ` +
          `This is for your own benefit, to help you understand the data you're extracting; ` +
          `it won't be included in the final output.`,
      },
      row_data: {
        type: 'object',
        description: `
The data for this row, with keys corresponding to column names.
If the row doesn't have any data for a particular column, 
then the value for that column should be an empty string.
`,
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    required: ['discussion', 'row_data'],
    additionalProperties: false,
  };

  for (const columnName of columnNames) {
    schema.properties.row_data.properties[columnName] = { type: 'string' };
    schema.properties.row_data.required.push(columnName);
  }

  return schema;
};

/**
 * Populates the data rows of a single table by reading its page images.
 *
 * Mutates `table` in place, filling `table.data` with the extracted body rows
 * and updating `table.page_end` to reflect the last page the table appears on.
 *
 * Starting from `table.page_start`, the function reads each page image in
 * sequence. For each page it asks the model to transcribe the table's body rows
 * into structured JSON keyed by `table.columns`. It then checks whether the
 * page boundary split the last row across pages and, if so, merges the
 * continuation into the previous row's record. Iteration stops as soon as the
 * model reports that the table does not reach the bottom of the current page,
 * or there are no more pages left to read.
 *
 * Prerequisites — the caller must have already set on `table` before calling:
 * - `table.name` — used in all prompts to identify the table.
 * - `table.description` — used as additional context for the model.
 * - `table.columns` — defines the fields each row object will contain.
 * - `table.page_start` — the 1-based index of the first page to read.
 *
 * @param openaiClient OpenAI client used to drive the extraction conversations.
 * @param table The table record to populate; mutated in place.
 * @param pagePngBuffers Full array of page PNG buffers for the document (1-indexed via `table.page_start`).
 * @param additionalInstructions Optional caller-provided instructions forwarded to every OCR conversation.
 */
export const ocrImagesPopulateTableContents = async (
  openaiClient: OpenAI,
  table: OcrExtractedTable,
  pagePngBuffers: Buffer[],
  additionalInstructions?: string
): Promise<void> => {
  let pagePngBufferCurrent = pagePngBuffers[table.page_start - 1];

  const convo = _startOcrTableConversation(
    openaiClient,
    pagePngBufferCurrent,
    undefined,
    additionalInstructions,
    undefined
  );

  convo.addDeveloperMessage(`
For the purposes of this work session, we'll be focusing specifically and
exclusively on the following table:

Name/Identifier: ${table.name}
Description: ${table.description || '(No description provided; what you see is what you get.)'}

Columns:
- ${table.columns.join('\n- ')}
`);

  convo.addDeveloperMessage(`
During this work session, you'll be reading this table row by row, extracting the data from each
row's cells, and providing it to us in structured form.

We only care about "body rows", not header rows, footer rows, or summary/aggregation rows.
If you see any such non-body rows, you can ignore them and leave them out of the structured
data output.
`);

  convo.addUserMessage(
    `Transcribe the rows of table "${table.name}" as you see them on the image of the page.`
  );

  const jsonSchemaForTablePage = {
    name: 'ocr_extract_data_from_one_table',
    description: `
Extract all of the data rows from the table "${table.name}"
as they appear on the current page.
`,
    type: 'json_schema',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        does_table_have_rows_on_this_page: {
          type: 'boolean',
          description: `
A boolean indicating whether or not this table has any body rows on the current page.
This will presumably always be true for the first page that the table appears on;
for subsequent pages, it can be false for a number of reasons, e.g.:
- If the table continued to the end of the previous page but ended there.
- If the table continued onto this new page, but only has a footer or summary row here.
- Etc.
If this is false, then the "rows" field can be left as an empty array.
`,
        },
        rows: {
          type: 'array',
          items: _jsonSchemaForExtractingOneRowOfTableData(table.columns),
          description: `
An array of the table's body rows that are on the current page.
If the table "${table.name}" doesn't actually have any body rows on this page,
this can be an empty array.
`,
        },
        discuss_continuation_onto_next_page: {
          type: 'string',
          description: `
A discussion about whether or not this table looks like it continues onto the next page.
This includes a consideration of whether or not the bottom row itself looks like it might be
split across a page break, and any other clues that might indicate whether or not the table
continues onto the next page.
`,
        },
        does_table_reach_bottom_of_page: {
          type: 'boolean',
          description: `
A boolean indicating whether or not this table reaches the bottom of the current page.

This is false if the table clearly ends before the bottom of the page, such as when there is
some other table or some non-table text after the last row of this table, or if there is a 
clear footer or summary row that indicates the end of the table.

This is true if there is no clear indication that the table ends before the bottom of the page,
such as when the last row appears to be cut off or there is no footer or summary row. This
indicates the possibility that the table continues onto the next page.
`,
        },
      } as any,
      required: [
        'does_table_have_rows_on_this_page',
        'rows',
        'discuss_continuation_onto_next_page',
        'does_table_reach_bottom_of_page',
      ],
      additionalProperties: false,
    },
  };

  const jsonSchemaForSplitRow = {
    name: 'ocr_check_if_row_is_split_across_page_break',
    description: `
Determine whether or not the first row of this page is actually a continuation of the last row 
from the previous page, meaning that the row is split across a page break. This can happen
when a table row is too long to fit on one page, so it gets cut in half by the page break,
with part of the row on the previous page and part of it on this page. If the first row of
this page is indeed just a continuation of the last row from the previous page, then we should
treat it as the same row, rather than as a new row.`,
    type: 'json_schema',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        discuss_if_first_row_looks_like_continuation_of_previous_page_last_row:
          {
            type: 'string',
            description: `
A discussion about whether or not the first row of this page looks like
it might be a continuation of the last row from the previous page.
Discuss any clues that make you think it is or isn't actually just the
same data row split across a page break.
`,
          },
        is_row_split_across_page_break: {
          type: 'boolean',
          description: `
A boolean indicating whether or not the first row of this page is in fact 
a continuation of the last row from the previous page. True if the first 
row of this page is actually the same table row as the last row of the 
previous page, just split across a page break. False if the first row of 
this page is a completely new row, distinct from the last row of the previous page.
`,
        },
        split_row_data: {
          description: `
If we've decided that the row is indeed split across the page break, then re-transcribe
the row data here. This should be the full data for the row, including the portion that
was on the previous page as well as the portion that's on this page.
If the row is not split across the page break, set this to null.
`,
          anyOf: [
            { type: 'null' },
            _jsonSchemaForExtractingOneRowOfTableData(table.columns),
          ],
        },
      },
      required: [
        'discuss_if_first_row_looks_like_continuation_of_previous_page_last_row',
        'is_row_split_across_page_break',
        'split_row_data',
      ],
      additionalProperties: false,
    },
  };

  // page_start and page_end are 1-indexed.
  table.page_end = table.page_start;

  await convo.submit(undefined, undefined, {
    jsonResponse: { format: jsonSchemaForTablePage },
  });

  let hasRowsOnThisPage = convo.getLastReplyDictField(
    'does_table_have_rows_on_this_page',
    false
  ) as boolean;
  if (!hasRowsOnThisPage) {
    return;
  }

  let rows = convo.getLastReplyDictField('rows', []) as Array<any>;
  for (const row of rows) {
    const rowData = row.row_data as Record<string, string>;
    table.data.push(rowData);
  }

  let doesTableReachBottomOfPage = convo.getLastReplyDictField(
    'does_table_reach_bottom_of_page',
    false
  ) as boolean;
  if (!doesTableReachBottomOfPage) {
    return;
  }

  table.page_end++;

  for (; table.page_end <= pagePngBuffers.length; table.page_end++) {
    convo.addUserMessage(`
On the most recent page we examined (page ${table.page_end - 1}), 
the table "${table.name}" appears to reach the bottom of the page,
which indicates that it might continue onto the next page.
As such, we will continue extracting data from this table
by presenting you with the next page (page ${table.page_end}).
`);

    convo.addImage(
      'user',
      `Here is Page ${table.page_end} of the document.`,
      `data:image/png;base64,${pagePngBuffers[table.page_end - 1].toString('base64')}`
    );

    convo.addUserMessage(`
Before we begin transcribing all of the rows of this table on this new page, 
we first need to cover an important preliminary point about the possibility
of rows that may have been split across page breaks.

There's a chance that the last row of the previous page is itself
split across the page break, meaning that the row wasn't actually
complete when we transcribed it before. Just in case this is happening,
I'll show you the last row again, so that you can decide if the
first row of this new page is a continuation of the last row from
the previous page.

Here is the last row from page ${table.page_end - 1} that we just transcribed:

${JSON.stringify(table.data[table.data.length - 1], null, 2)}
`);

    await convo.submit(undefined, undefined, {
      jsonResponse: { format: jsonSchemaForSplitRow },
    });
    const isSplitRow = convo.getLastReplyDictField(
      'is_row_split_across_page_break',
      false
    );
    if (isSplitRow) {
      const splitRowData = convo.getLastReplyDictField(
        'split_row_data',
        null
      ) as Record<string, string> | null;
      if (splitRowData) {
        table.data[table.data.length - 1] = splitRowData;
      }
      convo.addUserMessage(`
Since we've determined that the last row from the previous page is indeed split
across the page break, we should transcribe the rows on this new page starting
*after* this split row. This split row isn't really the first row on this page;
it actually belongs to the previous page. Start our transcription with the first
*full* row on this page, which is the row immediately following this split row.
`);
    } else {
      convo.addUserMessage(`
Since we've determined that the last row from the previous page is *not* split
across the page break, we should transcribe the rows on this new page starting with the
topmost row, since that first row is indeed a new row whose data is presented on this
new page in its entirety.
`);
    }

    await convo.submit(undefined, undefined, {
      jsonResponse: { format: jsonSchemaForTablePage },
    });

    hasRowsOnThisPage = convo.getLastReplyDictField(
      'does_table_have_rows_on_this_page',
      false
    ) as boolean;
    if (!hasRowsOnThisPage) {
      return;
    }

    rows = convo.getLastReplyDictField('rows', []) as Array<any>;
    for (const row of rows) {
      const rowData = row.row_data as Record<string, string>;
      table.data.push(rowData);
    }

    doesTableReachBottomOfPage = convo.getLastReplyDictField(
      'does_table_reach_bottom_of_page',
      false
    ) as boolean;
    if (!doesTableReachBottomOfPage) {
      return;
    }
  }
};

/**
 * Extracts tabular data from PNG image buffers using AI-powered OCR.
 * Processes multiple pages, detects tables, handles tables spanning multiple pages,
 * extracts column headers, data rows, aggregations, and additional notes.
 *
 * Uses a multi-step AI approach:
 * 1. Identifies all tables on each page
 * 2. Detects if tables continue across pages
 * 3. Extracts column names
 * 4. Extracts all data rows
 * 5. Identifies aggregation/summary data
 * 6. Provides extraction notes
 *
 * @param openaiClient An instance of the OpenAI client to use for API calls
 * @param pagesAsPngBuffers Array of PNG image buffers representing document pages
 * @param additionalInstructions Optional custom instructions to guide the OCR process
 * @returns Array of extracted tables with their complete data structures
 */
export const ocrImagesExtractTableData = async (
  openaiClient: OpenAI,
  pagesAsPngBuffers: Buffer[],
  additionalInstructions?: string
): Promise<OcrExtractedTable[]> => {
  additionalInstructions = additionalInstructions || '';

  let retvalTables = [] as OcrExtractedTable[];

  let currentPageIndex = 0;
  let startWithTableName = '';
  while (currentPageIndex < pagesAsPngBuffers.length) {
    // TODO: Everywhere there's a console log, there should
    // instead be a callback to a progress tracking function.
    console.log(
      `Parsing Page ${currentPageIndex + 1} of ${pagesAsPngBuffers.length}` +
        (startWithTableName.length > 0
          ? `, starting with table "${startWithTableName}"`
          : '')
    );
    let didAlreadyIncrementPageIndex = false;

    const pagePngBuffer = pagesAsPngBuffers[currentPageIndex];
    const imgbuf = pagePngBuffer;
    const imgBase64 = imgbuf.toString('base64');
    const imgDataUrl = `data:image/png;base64,${imgBase64}`;

    const convoAboutPage = new GptConversation([], {
      openaiClient,
      model: GPT_MODEL_VISION,
    });

    // We'll just create the first message manually so that we can
    // include the image as an input in the very first prompt.
    const gptMsgWithImage = {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: `Here is Page ${currentPageIndex + 1} of a PDF document.`,
        },
        {
          type: 'input_image',
          image_url: imgDataUrl,
          detail: 'high',
        },
      ],
    };
    convoAboutPage.push(gptMsgWithImage);

    convoAboutPage.addDeveloperMessage(
      `We're scanning this page for **tabular data**.`
    );
    if (startWithTableName.length > 0) {
      convoAboutPage.addDeveloperMessage(`
Start with the table that we're calling "${startWithTableName}".
This is the first table that starts on the page.
If there are some table rows above this table, ignore them; they're from some prior table
that started on the previous page.
`);
      startWithTableName = '';
    }

    if (additionalInstructions) {
      convoAboutPage.addUserMessage(additionalInstructions);
    }
    convoAboutPage.addDeveloperMessage(`
Does this page contain any tables? Does it have just one table, or multiple tables?
What are the tables called? What fields do they contain? Discuss.

Don't worry about actually parsing the data in the tables yet. 

**DO** pay attention to tables that *start* on this page, even if they continue
onto later pages. This includes tables that might have their title or header on this page,
but their data continues onto later pages.
`);
    await convoAboutPage.submit();

    const tablesOnThisPage = convoAboutPage.getLastReplyDictField(
      'tables',
      []
    ) as unknown[];

    for (let iTable = 0; iTable < tablesOnThisPage.length; iTable++) {
      const table = tablesOnThisPage[iTable] as OcrExtractedTable;
      table.columns = [];
      table.data = [];
      table.notes = '';
      table.page_start = currentPageIndex + 1;
      table.page_end = currentPageIndex + 1;
      retvalTables.push(table);

      console.log(`Found table: ${table.name}`);

      let numPagesSpanned = 1;

      const convoAboutCurrentTable = new GptConversation([gptMsgWithImage], {
        openaiClient,
        model: GPT_MODEL_VISION,
      });
      convoAboutCurrentTable.addDeveloperMessage(`
We are performing OCR data extraction on this document, scanning
specifically for **tabular data**.

For the time being, let's focus specifically and exclusively on the following table:
Name: ${table.name}
Description: ${table.description}
`);

      if (
        iTable === tablesOnThisPage.length - 1 &&
        currentPageIndex < pagesAsPngBuffers.length - 1
      ) {
        // This is the last table on the page, and there are more pages in the document.
        // It might continue onto later pages, possibly even more than one.
        // We need to account for that.
        console.log(
          `  Last table on page ${currentPageIndex + 1}, may continue.`
        );

        convoAboutCurrentTable.addDeveloperMessage(`
Table "${table.name}" is the last table on the current page (Page ${currentPageIndex + 1}). 
We need to check whether it continues onto subsequent pages.
`);

        while (true) {
          currentPageIndex++;
          didAlreadyIncrementPageIndex = true;
          if (currentPageIndex >= pagesAsPngBuffers.length) {
            console.log(`  No more pages left to process.`);
            break;
          }
          const pagePngBuffer = pagesAsPngBuffers[currentPageIndex];
          const imgbuf = pagePngBuffer;
          const imgBase64 = imgbuf.toString('base64');
          const imgDataUrl = `data:image/png;base64,${imgBase64}`;

          convoAboutCurrentTable.push({
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `Here is Page ${currentPageIndex + 1} of the PDF document.`,
              },
              {
                type: 'input_image',
                image_url: imgDataUrl,
                detail: 'high',
              },
            ],
          });
          convoAboutCurrentTable.addDeveloperMessage(`
Does the table called "${table.name}" continue onto this page?
Does this table possibly even continue onto yet more pages after this one?
Discuss.
`);
          await convoAboutCurrentTable.submit();

          await convoAboutCurrentTable.submit(undefined, undefined, {
            jsonResponse: JSONSchemaFormat(
              {
                does_table_continue_onto_this_page: [
                  Boolean,
                  `True if the table called "${table.name}" continues onto this page, from the prior page(s). False if it does not.`,
                ],
                might_continue_onto_additional_pages: [
                  Boolean,
                  `True if the table called "${table.name}" might continue onto yet more pages after this one. False if we can see that this table has definitely ended on this page.`,
                ],
                name_of_next_table_if_any: [
                  String,
                  `If there is another table that starts on this page after the current table "${table.name}" (even if it's only a partial table, or possibly even just a table header), provide its name here. If there is no such next table, provide a blank string.`,
                ],
              },
              'ocr_check_table_continuation',
              `Determine whether the table called "${table.name}" continues onto this page.`
            ),
          });

          const doesTableContinue =
            convoAboutCurrentTable.getLastReplyDictField(
              'does_table_continue_onto_this_page',
              false
            ) as boolean;

          if (doesTableContinue) {
            console.log(
              `  Table "${table.name}" continues onto Page ${currentPageIndex + 1}.`
            );
            numPagesSpanned++;
          } else {
            console.log(
              `  Table "${table.name}" does NOT continue onto Page ${currentPageIndex + 1}.`
            );
            break;
          }
          const mightContinue = convoAboutCurrentTable.getLastReplyDictField(
            'might_continue_onto_additional_pages',
            false
          ) as boolean;
          if (!mightContinue) {
            console.log(
              `  Table "${table.name}" ends on Page ${currentPageIndex + 1}.`
            );
            startWithTableName = convoAboutCurrentTable.getLastReplyDictField(
              'name_of_next_table_if_any',
              ''
            ) as string;
            console.log(
              `    Next table on this page (if any): "${startWithTableName}".`
            );

            if (!startWithTableName || startWithTableName.length === 0) {
              // No other tables on this page.
              // Advance the page index.
              currentPageIndex++;
            }
            break;
          }
        }
      }

      convoAboutCurrentTable.addDeveloperMessage(`
Look specifically at the table called "${table.name}" 
and determine what its column names are,
based on headers or other observable information. 
Discuss.
`);
      await convoAboutCurrentTable.submit();

      await convoAboutCurrentTable.submit(undefined, undefined, {
        jsonResponse: JSONSchemaFormat(
          {
            column_names: [String],
          },
          'ocr_extract_columns_from_one_table',
          `Extract the column names from the table called "${table.name}".`
        ),
      });
      table.columns = convoAboutCurrentTable.getLastReplyDictField(
        'column_names',
        []
      ) as string[];

      console.log(`  Columns: ${table.columns.join(', ')}`);

      if (table.columns.length === 0) {
        // This table will be filtered out later.
        console.warn(
          `  Table "${table.name}" has no columns; skipping data extraction.`
        );
        continue;
      }

      // Create a JSON schema for extracting each row of the actual table data.
      const tableRowExtractionSchema = {
        type: 'object',
        properties: {
          discussion: {
            type: 'string',
            description:
              `A discussion of what data this row contains. State what this item is, ` +
              `what fields it contains, what values those fields contain, ` +
              `and any other relevant context or observations. ` +
              `This is for your own benefit, to help you understand the data you're extracting; ` +
              `it won't be included in the final output.`,
          },
        } as Record<string, any>,
        required: ['discussion'] as string[],
        additionalProperties: false,
      };
      for (const columnName of table.columns) {
        tableRowExtractionSchema.properties[columnName] = {
          type: 'string',
          description:
            `The value in the "${columnName}" column of this row. ` +
            `(If the corresponding cell is blank, leave this as a blank string.)`,
        };
        tableRowExtractionSchema.required.push(columnName);
      }

      convoAboutCurrentTable.addDeveloperMessage(`
Look specifically at the table called "${table.name}" and extract all of its data rows. 

Include only the table's "body rows", not any rows that might be headers, footers, or 
summary/aggregation rows.
`);

      if (numPagesSpanned > 1) {
        convoAboutCurrentTable.addDeveloperMessage(`
Remember, the table "${table.name}" spans across ${numPagesSpanned} pages.
Be sure to extract data from every one of this table's rows, even if they're on different pages.

CAREFUL: Be particularly mindful about individual rows that might be split across page breaks!
`);
      }

      await convoAboutCurrentTable.submit(undefined, undefined, {
        jsonResponse: JSONSchemaFormat(
          {
            table_rows: [tableRowExtractionSchema],
          },
          'ocr_extract_data_from_one_table',
          `Extract all of the data rows from the table called "${table.name}".`
        ),
      });
      table.data = convoAboutCurrentTable.getLastReplyDictField(
        'table_rows',
        []
      ) as Array<Record<string, string>>;

      console.log(`  Extracted ${table.data.length} data rows.`);

      convoAboutCurrentTable.addDeveloperMessage(`
Does the table have any "aggregations", such as totals, averages, counts, or similar summary
data? We don't need to extract these as structured data, i.e. we don't need to parse them into
fields and JSON objects and whatnot. But we *do* need to know if they're present,
and we *do* need to read them if they exist.
`);
      await convoAboutCurrentTable.submit(undefined, undefined, {
        jsonResponse: JSONSchemaFormat(
          {
            discussion: [
              String,
              `Talk through whether there are any aggregation or summary data in the ` +
                `table called "${table.name}". Describe what it is and what it says, ` +
                `if you find any. This is for your own benefit to help you understand ` +
                `the table; it won't be included in the final output.`,
            ],
            aggregation_data: [
              String`The extracted aggregation data, such as totals, averages, counts, or similar ` +
                `summary data, presented in textual form. If no such data is present, ` +
                `simply leave this as a blank string.`,
            ],
          },
          'ocr_check_for_aggregations_in_one_table',
          `Check for any aggregation data in the table called "${table.name}".`
        ),
      });
      table.aggregations = convoAboutCurrentTable.getLastReplyDictField(
        'aggregation_data',
        ''
      ) as string;

      convoAboutCurrentTable.addDeveloperMessage(`
We've now extracted the table's title, description, columns, data rows, and any aggregation
data. Finally, please provide any additional notes or observations about this table that
might be necessary for a downstream consumer of this data to know. This might include
comments about data quality, possible ambiguities, or any assumptions you had to make
during the extraction process.
If you have no additional notes, simply respond with a blank string.
`);
      convoAboutCurrentTable.submit();

      convoAboutCurrentTable.submit(undefined, undefined, {
        jsonResponse: JSONSchemaFormat(
          {
            extraction_notes: [
              String,
              `Any additional notes, comments, or observations about the table ` +
                `that might be useful for a downstream consumer of this data. ` +
                `If there are no such notes, simply provide a blank string.`,
            ],
          },
          'ocr_write_table_extraction_notes',
          `Any notes you feel you should provide about the table called "${table.name}", ` +
            `that might be useful for future interpretation or analysis.`
        ),
      });
      table.notes = convoAboutCurrentTable.getLastReplyDictField(
        'extraction_notes',
        ''
      ) as string;

      table.page_end = currentPageIndex + 1;
    }

    if (!didAlreadyIncrementPageIndex) {
      currentPageIndex++;
    }
  }

  // Filter out tables that have no columns or no data.
  // They were almost certainly mis-scans.
  retvalTables = retvalTables.filter(
    (table) => table.columns.length > 0 && table.data.length > 0
  );
  // Clean the "discussion" fields out of each row.
  for (const table of retvalTables) {
    for (const row of table.data) {
      delete row['discussion'];
    }
  }

  return retvalTables;
};
