import { GPT_MODEL_VISION } from '@mightydatainc/gpt-conversation';
import {
  ConversationMessage,
  GptConversation,
} from '@mightydatainc/gpt-conversation';
import { JSONSchemaFormat } from '@mightydatainc/gpt-conversation';
import { OcrExtractedTable } from './records.js';
import { OpenAI } from 'openai';

/**
 * Builds the initial user message payload for a vision-capable GPT request.
 *
 * Converts a PNG page buffer to a base64 data URL and combines it with a
 * text prompt so both text and image can be sent together in one message.
 * This is used to seed a `GptConversation` with the page image in the first
 * prompt.
 *
 * @param pagePngBuffer PNG image bytes for a single document page.
 * @param messageText Text instruction/context paired with the page image.
 * @returns A user-role message object containing `input_text` and `input_image` content items.
 */
const _generateGptMessageWithImage = (
  pagePngBuffer: Buffer,
  messageText: string
): ConversationMessage => {
  const imgbuf = pagePngBuffer;
  const imgBase64 = imgbuf.toString('base64');
  const imgDataUrl = `data:image/png;base64,${imgBase64}`;

  // We'll just create the first message manually so that we can
  // include the image as an input in the very first prompt.
  const gptMsgWithImage = {
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: messageText,
      },
      {
        type: 'input_image',
        image_url: imgDataUrl,
        detail: 'high',
      },
    ],
  };

  return gptMsgWithImage;
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
  nextPagePngBuffer?: Buffer
): GptConversation => {
  const messageText =
    pagePositionInDocument === 'first'
      ? `Here is the first page of a PDF document.`
      : pagePositionInDocument === 'last'
        ? `Here is the last page of a PDF document.`
        : pagePositionInDocument === 'middle'
          ? `Here is a from the middle of a PDF document.`
          : `Here is a page of a PDF document.`;
  const gptMsgWithImage = _generateGptMessageWithImage(
    pagePngBuffer,
    messageText
  );

  const convo = new GptConversation([gptMsgWithImage], {
    openaiClient,
    model: GPT_MODEL_VISION,
  });
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
a table whose title appears at the bottom of the current page, but whose data appears at
the top of the next page. When this happens, all you see at the bottom of the current page
is some random orphaned title, so you'll need to see the next page in order to see if that
title is actually the title of a table.
`;
    const nextPageGptMsgWithImage = _generateGptMessageWithImage(
      nextPagePngBuffer,
      nextPageMessageText
    );
    convo.addUserMessage(nextPageGptMsgWithImage);
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
