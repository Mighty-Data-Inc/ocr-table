import { GPT_MODEL_VISION } from '@mightydatainc/gpt-conversation';
import {
  ConversationMessage,
  GptConversation,
} from '@mightydatainc/gpt-conversation';
import { JSONSchemaFormat } from '@mightydatainc/gpt-conversation';
import { OcrExtractedTable } from './records.js';
import { OpenAI } from 'openai';

/**
 * Perform chain-of-thought by giving the AI a chance to "ponder"
 * after submitting a message, before we ask it to respond.
 * This often improves quality of the response, as it gives the model
 * a chance to "think" for a moment before responding. However, it burns
 * time and tokens. Use judiciously!
 * @param convo
 */
const _ponder = async (convo: GptConversation) => {
  // Noop for performance eval.
  // true = noop; false = actually ponder.
  const noop = () => true;
  noop() || (await convo.submit());
};

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
  nextPagePngBuffer?: Buffer,
  tableName?: string,
  tableDescription?: string,
  columnNames?: string[]
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
      `Here is the *next* page of the document. Remember, this isn't the *current* page. ` +
        `This is the page that appears *after* the current page. We're not directly interested` +
        `in this next page. We're only showing it to you because, sometimes, under certain ` +
        `circumstances, seeing the next page will help you recontextualize some of the table ` +
        `data that appears at the bottom of the current page.`,
      nextPageImgDataUrl
    );

    convo.addDeveloperMessage(`
The user has shown you the next page of the document for the sake of contextualization.
You've seen it, and that's great. But now, however, let's not get distracted.
Let's turn our attention back to the *current* page.
`);
  }

  if (additionalInstructions) {
    convo.addUserMessage(additionalInstructions);
  }

  if (tableName || tableDescription || columnNames) {
    tableName =
      tableName ||
      `(No name provided; use your best judgment ` +
        `to determine which table we're talking about.)`;
    tableDescription =
      tableDescription ||
      `(No description provided; what you see is what you get.)`;

    let sSpecificTable = `
For the purposes of this work session, we'll be focusing specifically and
exclusively on the following table:

Name/Identifier: ${tableName}
Description: ${tableDescription}
`;
    if (columnNames && columnNames.length > 0) {
      sSpecificTable += `
Columns:
- ${columnNames.join('\n- ')}
`;
    }
    convo.addDeveloperMessage(sSpecificTable);
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
): Promise<{ name: string; description: string }[]> => {
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

Let's start with a general discussion of what you see on this page. Describe its
layout and the tables (or table fragments) that you see on it.
`);
  await _ponder(convo);

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

  const tablesOnThisPage = convo.getLastReplyDictField('tables', []) as Array<{
    name: string;
    description: string;
  }>;

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
    nextPagePngBuffer,
    tableName,
    tableDescription
  );

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
 * Transcribes the body rows of a named table from a single page image.
 *
 * Uses a shotgun approach — running multiple parallel OCR workers and then
 * adjudicating their responses — to faithfully extract each cell value from
 * the table. If a next-page image is provided, also determines whether the
 * table continues onto that page and whether the last visible row was split
 * across the page break; when a split row is detected, the row is re-transcribed
 * by combining text from both pages before being returned.
 *
 * @param openaiClient OpenAI client used to drive the OCR conversation.
 * @param tableName Name or identifier of the table to transcribe.
 * @param tableDescription A brief description of the table's purpose, used to help the model locate it.
 * @param columns Ordered list of column names for the table.
 * @param pagePngBuffer PNG bytes of the current document page.
 * @param doesTableStartOnThisPage `true` if the table's first row begins on this page; `false` if this page shows a continuation from a prior page.
 * @param splitRowToIgnore Optional row (from the previous page) that was split across the page break and should be ignored at the top of this page.
 * @param additionalInstructions Optional caller-provided instructions to guide the OCR process.
 * @param nextPagePngBuffer Optional PNG bytes of the following page, used to detect table continuation and split rows.
 * @returns An object containing the extracted body rows, a flag indicating whether the table continues onto the next page, and a flag indicating whether the last row was split across the page break.
 */
export const ocrTranscribeTableRowsFromCurrentPage = async (
  openaiClient: OpenAI,
  tableName: string,
  tableDescription: string,
  columns: string[],
  pagePngBuffer: Buffer,
  doesTableStartOnThisPage: boolean,
  splitRowToIgnore?: Record<string, string>,
  additionalInstructions?: string,
  nextPagePngBuffer?: Buffer
): Promise<{
  rows: Array<Record<string, string>>;
  doesTableContinueOnNextPage: boolean;
  doesLastRowGetSplitAcrossPageBreak: boolean;
}> => {
  const convo = _startOcrTableConversation(
    openaiClient,
    pagePngBuffer,
    undefined,
    additionalInstructions,
    undefined,
    tableName,
    tableDescription,
    columns
  );

  convo.addDeveloperMessage(`
In this work session, we'll be transcribing the rows of this table (the one
called "${tableName}") as they appear on this page. You'll try to faithfully
replicate the data in each row as accurately as possible, capturing all of the
text in each of the columns for each row.

We only care about "body rows", not header rows, footer rows, or summary/aggregation rows.
If you see any such non-body rows, you can ignore them and leave them out of the structured
data output.

We only care about the rows of table ${tableName}. If that table ends, and other
text or tables appear after it on the page, you can ignore all of that other content.
Just focus on transcribing the rows of this one table.

If a particular cell is empty, just put an empty string for that cell's value.

DO NOT TAKE LIBERTIES WITH THE TEXT. Transcribe the text *exactly* as it appears
in the source image. Pay particularly close attention to punctuation and capitalization.

PRO TIP: If a table cell literally says the word "None", "N/A", or "Blank", then transcribe
it exactly as it says it, i.e. the word "None", "N/A", "Blank", etc. There's a semantic
difference between a cell that is blank versus a cell that *says* "Blank", or between a
cell with no contents versus a cell whose contents are the word "None".
`);

  if (!doesTableStartOnThisPage) {
    convo.addUserMessage(`
This table, ${tableName}, doesn't actually start on this page. What you see at the top of this
page is a continuation of the table that started on a previous page. As such, I know you can't
see the table's title or column headers and other metadata. But you can see its column list
and its rows, so that should be enough for you to be able to transcribe its contents.
`);
  }

  if (splitRowToIgnore) {
    convo.addUserMessage(`
You've probably noticed that there's only a partial row at the top of the page --
either errant text, or a row that looks messy, incomplete, or incoherent.
This is because that row got split across a page break, with part of
the row on the previous page and part of it on this page.

You should ignore this row and not include it in the structured data output.
We'll handle this row separately in a different step; don't worry about it for now.

Here is the full row at the top of the page that we're talking about. This is the row
that you should ignore in your output. I know you can only see part of it on this page,
but here is the full row so that you understand what it is that you're ignoring:

${JSON.stringify(splitRowToIgnore, null, 2)}
`);
  }

  const jsonSchemaForTablePage = {
    name: 'ocr_extract_data_from_one_table',
    description: `
Extract all of the data rows from the table "${tableName}"
as they appear on the current page, transcribing them exactly as they appear.
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
          items: _jsonSchemaForExtractingOneRowOfTableData(columns),
          description: `
An array of the table's body rows that are on the current page.
If the table "${tableName}" doesn't actually have any body rows on this page,
this can be an empty array.
`,
        },
      } as any,
      required: ['does_table_have_rows_on_this_page', 'rows'],
      additionalProperties: false,
    },
  };

  // Run convo clones in parallel, and resolve discrepancies with a master run.
  const NUM_SHOTGUN_BARRELS = 4;
  const convoShotgun: GptConversation[] = [];
  for (let i = 0; i < NUM_SHOTGUN_BARRELS; i++) {
    const convoBarrel = convo.clone();
    convoShotgun.push(convoBarrel);
  }
  // Use Promise.all to run the barrels in parallel.
  await Promise.all(
    convoShotgun.map((convoBarrel) =>
      convoBarrel.submit(undefined, undefined, {
        jsonResponse: { format: jsonSchemaForTablePage },
      })
    )
  );

  convo.addSystemMessage(`
We are running these extractions via ${NUM_SHOTGUN_BARRELS} parallel workers 
to get multiple independent takes on the data, which will help us resolve any
uncertainties or discrepancies.
`);
  convoShotgun.forEach((convoBarrel, index) => {
    convo.addSystemMessage(`
RESPONSE FROM WORKER #${index + 1}
---
${JSON.stringify(convoBarrel.getLastReplyDict(), null, 2)}
`);
  });
  convo.addDeveloperMessage(`
Focus on the differences and discrepancies between the workers' responses. Where do they agree?
Where do they disagree? In the areas where they disagree, which worker's argument is most consistent
with the data in the source image(s)? Remember, this is an adjudication, not a democracy -- 
you should go look at the source image(s) and use your best judgment to determine which worker
is most likely to be correct.
`);
  await _ponder(convo);
  convo.addSystemMessage(`
Adjudicate and resolve any discrepancies between the different workers' responses.
In the places where they agree, great. In the places where they disagree, side with
the one whose argument is most consistent with the data in the source image(s), 
and with the reasoning that makes the most sense.
`);
  await convo.submit(undefined, undefined, {
    jsonResponse: { format: jsonSchemaForTablePage },
  });

  let hasRowsOnThisPage = convo.getLastReplyDictField(
    'does_table_have_rows_on_this_page',
    false
  ) as boolean;
  if (!hasRowsOnThisPage) {
    return {
      rows: [],
      doesTableContinueOnNextPage: false,
      doesLastRowGetSplitAcrossPageBreak: false,
    };
  }

  let rowsFromOcr = convo.getLastReplyDictField('rows', []) as Array<any>;
  let rows: Array<Record<string, string>> = [];
  for (const row of rowsFromOcr) {
    const rowData = row.row_data as Record<string, string>;
    rows.push(rowData);
  }
  if (rows.length === 0) {
    return {
      rows: [],
      doesTableContinueOnNextPage: false,
      doesLastRowGetSplitAcrossPageBreak: false,
    };
  }

  if (!nextPagePngBuffer) {
    // If we don't have the next page image, then we don't need to perform all the complex
    // logic involving determining whether or not the table continues onto the next page,
    // and whether or not the last row is split across a page break.
    return {
      rows,
      doesTableContinueOnNextPage: false,
      doesLastRowGetSplitAcrossPageBreak: false,
    };
  }

  convo.addUserMessage(`
Just so that we're clear on context, here is the *last row* of the table "${tableName}"
on this page, based on the data you just extracted:

LAST ROW OF TABLE "${tableName}" ON THIS PAGE:
${JSON.stringify(rows[rows.length - 1], null, 2)}
`);

  convo.addUserMessage(`
I'll now also show you the *next* page of the document.
Sometimes, a table's body continues onto the next page. Hopefully, that isn't the case for
our current table of interest: table "${tableName}". But just in case it is -- that is,
if the table does indeed run down to the end of the current page and resume on the next page
-- then we want to be able to recognize that and handle it properly.
`);

  convo.addImage(
    'user',
    'Here is the next page of the document.',
    `data:image/png;base64,${nextPagePngBuffer.toString('base64')}`
  );

  convo.addUserMessage(`
Your job now is to determine the following:

- Does the table "${tableName}" continue onto the next page, or does it end on this page?
  Telltale indicators that a table continues onto the next page include:
    - The table runs all the way down to the bottom of the page, with no other text or 
      tables after it.
    - The next page starts with what looks like a continuation of the table, with similar 
      formatting and structure.
    - Visual indicators of a page break interrupting the table, such as a dashed line or
      an open border.

- Does the last row of the table that we see on this page get split across the page break,
  with part of the row on this page and part of it on the next page? Telltale indicators
  of a row being split across a page break include:
    - The row has visual indicators of being split, such as a dashed line or a missing bottom 
      border.
    - The next page starts with text that could be a continuation of the row. This could 
      appear as a row at the top of the page that has similar formatting but missing
      or incomplete data, or it could appear as strangely errant or isolated text at the top
      of the next page. Look carefully for partial text, or a row with mostly empty cells, 
      or other signs of incomplete or truncated content that could indicate that the next page
      contains a continuation of the last row from this page.
    - Some of the data in the row's cells looks incomplete, messy, or truncated. (For this
      determination, it helps to go cell by cell in the last row and ask yourself whether
      or not it looks like the content of that cell got cut off or otherwise looks
      suspiciously empty.)

PRO TIP: One very strong indicator that a row has been split across a page break is if the
last row has some cells that are truncated, incomplete, or empty -- and then you see a partial
row or errant text at the top of the next page that happens to be in exactly the same
columns or positions as those truncated, incomplete, or empty cells. When this happens, you
should try and write out the concatenations of these two pieces of text (the truncated cell
on this page, plus the potential continuation on the next page) on a cell-by-cell basis to 
see if they look like a plausible full cell of data that got split across the page break.
If they do look like a plausible concatenation, then that's a very strong signal that the
row got split across the page break, with part of it on this page and part of it on the next page.
`);
  // Let it discuss this with itself.
  // Naturally, we're shotgunning this.
  const jsonFormatForPageBreakDiscussion = JSONSchemaFormat(
    {
      description_of_bottom_of_current_page: [
        String,
        `To help organize your thoughts and to guide your reasoning, provide a detailed ` +
          `description of what you see at the bottom of the current page. Is there any ` +
          `text or other content below the table we're examining (table "${tableName}")? ` +
          `Typically, if there's more page content such as text or another table below ` +
          `the table we're examining, then that's a strong signal that the table does not ` +
          `continue onto the next page. If, however, there is no more page content below ` +
          `the table (or simply metadata content such as a footer, page number, footnote, ` +
          `etc.), then it's possible that the table continues onto the next page.`,
      ],
      description_of_top_of_next_page: [
        String,
        `To help organize your thoughts and to guide your reasoning, provide a detailed ` +
          `description of what you see at the top of the next page. `,
      ],
      discussion_overall: [
        String,
        `A thorough and detailed discussion about whether or not the table "${tableName}" ` +
          `continues onto the next page, and whether or not the last row of the table on this ` +
          `page got split across the page break. Use the telltale signs mentioned above to ` +
          `guide your reasoning.`,
      ],
      discuss_does_table_continue_to_next_page: [
        String,
        `Using the telltale signs mentioned above, in combination with your own judgment, ` +
          `determine whether or not the table "${tableName}" continues onto the next page. ` +
          `Discuss your reasoning and observations in coming to this conclusion.`,
      ],
      does_table_continue_on_next_page: Boolean,
      try_out_potential_concatenations: [
        [String],
        `If the last row of the table on this page has some cells that look truncated, ` +
          `incomplete, or empty, and there are pieces of text at the top of the next page ` +
          `that look errant, misprinted, or out of place (or possibly a partial row at the ` +
          `top of the next page that looks incomplete or incomprehensible), then it's very ` +
          `likely that one "plugs into" the other. Try writing out the cell-by-cell ` +
          `concatenations of these pieces of text to see if they look like a plausible ` +
          `full cell of data that could have gotten split across the page break.`,
      ],
      discuss_is_last_row_split_across_page_break: [
        String,
        `Using the telltale signs mentioned above, in combination with your own judgment, ` +
          `determine whether or not the last row of the table "${tableName}" on this page got ` +
          `split across the page break, with part of the row on this page and part of it on the ` +
          `next page. Discuss your reasoning and observations in coming to this conclusion.`,
      ],
      does_last_row_get_split_across_page_break: Boolean,
    },
    'ocr_detect_table_continuation_and_split_rows',
    `Determine whether or not the table "${tableName}" continues onto the next page, and ` +
      `whether or not the last row of the table on this page got split across the page break.`
  );
  const convoShotgunPageBreakDiscussion: GptConversation[] = [];
  for (let i = 0; i < NUM_SHOTGUN_BARRELS; i++) {
    const convoBarrel = convo.clone();
    convoShotgunPageBreakDiscussion.push(convoBarrel);
  }
  await Promise.all(
    convoShotgunPageBreakDiscussion.map((convoBarrel) =>
      convoBarrel.submit(undefined, undefined, {
        jsonResponse: jsonFormatForPageBreakDiscussion,
      })
    )
  );
  convo.addSystemMessage(`
We had ${NUM_SHOTGUN_BARRELS} independent workers analyze whether or not the table "${tableName}"
continues onto the next page, and whether or not the last row of the table on this page got
split across the page break. Here are their responses:
`);
  convoShotgunPageBreakDiscussion.forEach((convoBarrel, index) => {
    convo.addSystemMessage(`
RESPONSE FROM WORKER #${index + 1}
---
${JSON.stringify(convoBarrel.getLastReplyDict(), null, 2)}
`);
  });
  convo.addDeveloperMessage(`
Focus on the differences and discrepancies between the workers' responses. Where do they agree?
Where do they disagree? In the areas where they disagree, which worker's argument is most consistent
with the data in the source image(s)? Remember, this is an adjudication, not a democracy -- 
you should go look at the source image(s) and use your best judgment to determine which worker
is most likely to be correct.
`);
  await _ponder(convo);
  convo.addSystemMessage(`
Adjudicate and resolve any discrepancies between the different workers' responses regarding
whether or not the table "${tableName}" continues onto the next page, and whether or not the last
row of the table on this page got split across the page break. In the places where they agree,
great. In the places where they disagree, side with the one whose argument is most consistent
with the data in the source image(s).
`);
  await convo.submit(undefined, undefined, {
    jsonResponse: jsonFormatForPageBreakDiscussion,
  });

  let doesTableContinueOnNextPage = convo.getLastReplyDictField(
    'does_table_continue_on_next_page',
    false
  ) as boolean;

  let doesLastRowGetSplitAcrossPageBreak = convo.getLastReplyDictField(
    'does_last_row_get_split_across_page_break',
    false
  ) as boolean;

  if (doesLastRowGetSplitAcrossPageBreak) {
    convo.addUserMessage(`
Since you've determined that the last row of the table on this page got split across the page break,
let's re-transcribe that last row, taking into account the information both the part of the row on
this page and the part of the row that bled over onto the next page. Please provide a transcription
of the full row, combining the information from both pages on a cell-by-cell basis, thus enabling
us to know what the row would have looked like if it hadn't been split across the page break in the
first place.
`);

    const jsonSchemaForSplitRowTranscription = {
      name: 'ocr_repair_transcription_of_row_split_across_page_break',
      description: `
A transcription of the full row that got split across the page break, 
combining the information from both pages.
`,
      type: 'json_schema',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          the_split_row: _jsonSchemaForExtractingOneRowOfTableData(columns),
        } as any,
        required: ['the_split_row'],
        additionalProperties: false,
      },
    };

    // Shotgun!
    // Because we're performing OCR, we once again need to shotgun this to get multiple independent
    // takes and resolve discrepancies.
    const convoShotgun: GptConversation[] = [];
    for (let i = 0; i < NUM_SHOTGUN_BARRELS; i++) {
      const convoBarrel = convo.clone();
      convoShotgun.push(convoBarrel);
    }
    await Promise.all(
      convoShotgun.map((convoBarrel) =>
        convoBarrel.submit(undefined, undefined, {
          jsonResponse: { format: jsonSchemaForSplitRowTranscription },
        })
      )
    );
    convo.addSystemMessage(
      `We had ${NUM_SHOTGUN_BARRELS} independent workers re-transcribe the ` +
        `split row. Here are their responses:`
    );
    convoShotgun.forEach((convoBarrel, index) => {
      convo.addSystemMessage(`
RESPONSE FROM WORKER #${index + 1}
---
${JSON.stringify(convoBarrel.getLastReplyDict(), null, 2)}
`);
    });
    convo.addDeveloperMessage(`
Focus on the differences and discrepancies between the workers' responses. Where do they agree?
Where do they disagree? In the areas where they disagree, which worker's argument is most consistent
with the data in the source image(s)? Remember, this is an adjudication, not a democracy -- 
you should go look at the source image(s) and use your best judgment to determine which worker
is most likely to be correct.
`);
    await _ponder(convo);
    convo.addSystemMessage(`
Adjudicate and resolve any discrepancies between the different workers' responses
regarding the transcription of the split row. In the places where they agree, great.
In the places where they disagree, side with the one whose argument is most consistent
with the data in the source image(s).
`);

    await convo.submit(undefined, undefined, {
      jsonResponse: { format: jsonSchemaForSplitRowTranscription },
    });
    const splitRowTranscription = convo.getLastReplyDictField(
      'the_split_row',
      null
    ) as any | null;
    if (splitRowTranscription) {
      // Set the last row of the rows array to be the split row transcription that we just got,
      // which should be a more complete and accurate transcription of that row, since it takes
      // into account the information from both pages.
      const splitRowData = splitRowTranscription.row_data as Record<
        string,
        string
      >;
      rows[rows.length - 1] = splitRowData;
    }
  }

  return {
    rows,
    doesTableContinueOnNextPage,
    doesLastRowGetSplitAcrossPageBreak,
  };
};

/**
 * Extracts all rows of a named table from a multi-page document, starting at a given page.
 *
 * First determines the table's column headers from the starting page, then iterates
 * page-by-page calling `ocrTranscribeTableRowsFromCurrentPage` until the table no longer
 * continues. Split rows that straddle a page break are detected and their corrected
 * transcription is carried forward as the `splitRowToIgnore` hint on the next page.
 *
 * @param openaiClient OpenAI client used for all OCR conversations.
 * @param tableName Name or identifier of the table to extract.
 * @param tableDescription A brief description of the table's purpose.
 * @param numPageStart 1-based index of the page on which the table starts.
 * @param pagePngBuffers Array of PNG buffers for all pages in the document (1-based page numbers map to 0-based array indices).
 * @param additionalInstructions Optional caller-provided instructions to guide the OCR process.
 * @returns A fully populated `OcrExtractedTable` containing the table's name, description, columns, data rows, and the page range it was found on.
 */
export const ocrTranscribeTableFromPages = async (
  openaiClient: OpenAI,
  tableName: string,
  tableDescription: string,
  numPageStart: number,
  pagePngBuffers: Buffer[],
  additionalInstructions?: string
): Promise<OcrExtractedTable> => {
  let pagePngBufferCurrent = pagePngBuffers[numPageStart - 1];

  let pagePngBufferNext: Buffer | undefined = undefined;
  if (numPageStart < pagePngBuffers.length) {
    pagePngBufferNext = pagePngBuffers[numPageStart];
  }

  let numPageEnd = numPageStart;
  let splitRowToIgnore: Record<string, string> | undefined = undefined;

  const columns = await ocrImagesExtractTableColumnHeaders(
    openaiClient,
    tableName,
    pagePngBufferCurrent,
    additionalInstructions,
    tableDescription,
    pagePngBufferNext
  );

  const tableRowsAll: Array<Record<string, string>> = [];
  for (let iPage = numPageStart; iPage <= pagePngBuffers.length; iPage++) {
    numPageEnd = iPage;
    pagePngBufferCurrent = pagePngBuffers[iPage - 1];

    pagePngBufferNext = undefined;
    if (iPage < pagePngBuffers.length) {
      pagePngBufferNext = pagePngBuffers[iPage];
    }

    const tableScanThisPage = await ocrTranscribeTableRowsFromCurrentPage(
      openaiClient,
      tableName,
      tableDescription,
      columns,
      pagePngBufferCurrent,
      iPage === numPageStart,
      splitRowToIgnore,
      additionalInstructions,
      pagePngBufferNext
    );

    if (tableScanThisPage.rows) {
      tableRowsAll.push(...tableScanThisPage.rows);

      if (tableScanThisPage.doesLastRowGetSplitAcrossPageBreak) {
        splitRowToIgnore =
          tableScanThisPage.rows[tableScanThisPage.rows.length - 1];
      }
    }

    if (!tableScanThisPage.doesTableContinueOnNextPage) {
      break;
    }
  }

  // TODO: Read table notes and aggregations.
  const retval: OcrExtractedTable = {
    name: tableName,
    description: tableDescription,
    columns,
    data: tableRowsAll,
    page_start: numPageStart,
    page_end: numPageEnd,
    notes: '',
    aggregations: '',
  };
  return retval;
};

export const ocrTablesFromPngPages = async (
  openaiClient: OpenAI,
  pagesAsPngBuffers: Buffer[],
  additionalInstructions?: string
): Promise<OcrExtractedTable[]> => {
  const tables: OcrExtractedTable[] = [];

  let numPageCurrent = 1;
  let didPreviousPageEndWithTable = false;
  let nameOfFirstTableOnPage = ''; // Not actually used.

  while (numPageCurrent <= pagesAsPngBuffers.length) {
    const pagePngBufferCurrent = pagesAsPngBuffers[numPageCurrent - 1];

    let pagePngBufferNext: Buffer | undefined = undefined;
    if (numPageCurrent < pagesAsPngBuffers.length) {
      pagePngBufferNext = pagesAsPngBuffers[numPageCurrent];
    }

    const pagePositionInDocument: 'first' | 'middle' | 'last' =
      numPageCurrent == 1
        ? 'first'
        : numPageCurrent == pagesAsPngBuffers.length
          ? 'last'
          : 'middle';

    const tablesOnThisPage = await ocrIdentifyTablesOnPage(
      openaiClient,
      pagePngBufferCurrent,
      pagePositionInDocument,
      didPreviousPageEndWithTable,
      nameOfFirstTableOnPage,
      additionalInstructions,
      pagePngBufferNext
    );

    // Okay, soooo... We can't take for granted that the tables
    // will necessarily be listed in the order that they appear on the page.
    // However, we *can* take for granted that only one table will bleed off
    // of the page; all the other tables will be fully contained on the page.
    // So we'll iterate over each of the tables that we found on the page,
    // and we'll look at each of their page_end fields, and the highest
    // page_end field will be the one that we set as maxPageEnd -- which
    // will become numPageCurrent in the next loop iteration.

    let maxPageEnd = numPageCurrent;
    for (const tableNameDesc of tablesOnThisPage) {
      const tableObj = await ocrTranscribeTableFromPages(
        openaiClient,
        tableNameDesc.name,
        tableNameDesc.description,
        numPageCurrent,
        pagesAsPngBuffers,
        additionalInstructions
      );
      tables.push(tableObj);
      if (tableObj.page_end > maxPageEnd) {
        maxPageEnd = tableObj.page_end;
      }
    }

    if (maxPageEnd === numPageCurrent) {
      // All of the tables that we found on this page were fully contained on
      // this page; none of them bled onto the next page.
      // We advance the page counter manually.
      didPreviousPageEndWithTable = false;
      numPageCurrent++;
    } else {
      // At least one of the tables that we found on this page overran the page.
      // It might have continued for multiple pages for all we know.
      // We need to advance the page counter to the page that that table
      // left off on.
      didPreviousPageEndWithTable = true;
      numPageCurrent = maxPageEnd;
    }
  }

  return tables;
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
  throw new Error(
    'Deprecated. This is only included here for reference while writing new code.'
  );

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
