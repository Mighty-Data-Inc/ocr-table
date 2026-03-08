import { GPT_MODEL_VISION } from '@mightydatainc/gpt-conversation';
import { GptConversation } from '@mightydatainc/gpt-conversation';
import { OpenAI } from 'openai';

interface OcrExtractionRecord {
  field_name: string;
  field_value: string;
  where_found_in_document: string;
  value_confidence: string;
}

export const ocrStructuredFields = async (
  openaiClient: OpenAI,
  pagesAsPngBuffers: Buffer[],
  fieldsToExtract: Record<string, string>,
  additionalInstructions?: string
): Promise<Record<string, string>> => {
  // As we find fields, we'll be removing them from the fieldsToExtract object.
  // As such, let's make a deep copy of it to avoid mutating the caller's object.
  fieldsToExtract = JSON.parse(JSON.stringify(fieldsToExtract));

  const extractionsSoFar: Record<string, OcrExtractionRecord> = {};

  const convoBase = new GptConversation([], {
    openaiClient,
    model: GPT_MODEL_VISION,
  });

  convoBase.addDeveloperMessage(`
The user will show you an image of pages from a document (presumably a PDF,
but it could be a web page, a picture, or some other format).

Your task will be to extract specific structured fields from this page.

We will go through this document page by page, looking for the structured
fields we want to extract.
`);

  if (additionalInstructions) {
    convoBase.addDeveloperMessage(`
Here are some additional instructions to guide you in the extraction process:
${additionalInstructions}
`);
  }

  convoBase.addDeveloperMessage(`
Here are the fields we want to extract from this document:

${JSON.stringify(fieldsToExtract, null, 2)}
`);

  let iterationNotes = '';

  for (let i = 0; i < pagesAsPngBuffers.length; i++) {
    const pageBuffer = pagesAsPngBuffers[i];
    const pageBufferPrevious = i > 0 ? pagesAsPngBuffers[i - 1] : null;

    const convo = convoBase.clone();

    convo.addUserMessage(`
Here is page ${i + 1} of the document:
`);
    convo.addImage(
      'user',
      `Here is page ${i + 1} of the document:`,
      `data:image/png;base64,${pageBuffer.toString('base64')}`
    );

    if (pageBufferPrevious) {
      convo.addUserMessage(`
For the sake of context (in case any crucial information is split across a 
page break), here is the previous page (${i}) as well:
`);
      convo.addImage(
        'user',
        `Here is the previous page (${i}) for context:`,
        `data:image/png;base64,${pageBufferPrevious.toString('base64')}`
      );
    }

    // If we have extracted any fields so far, let's share that information as well
    // to help the model avoid redundant extractions and to provide more context.
    if (Object.keys(extractionsSoFar).length > 0) {
      convo.addUserMessage(`
Here are the fields we've already extracted from previous pages, 
along with where we found them and how confident we are in their values:
${JSON.stringify(extractionsSoFar, null, 2)}

Please use this information to avoid redundant extractions and to provide
more context as you look for the remaining fields.

If we extracted a field before but you see more concrete information on this page that
contradicts the previous extraction, please prioritize the information on this page
based on the evidence you see, and update the value accordingly if you believe that
that's the right move.
`);
    }

    if (iterationNotes) {
      convo.addSystemMessage(`
Here are some notes from the previous iterations that might be helpful:
${iterationNotes}
`);
    }

    convo.addUserMessage(`
Do you see any of the fields we're looking for on this page? If so, please fill out the
JSON object below with the field names, their corresponding values as found on this page,
a description of where you found them in the document (e.g. "in an About Us panel", 
"gleaned from a transcript of an email exchange that was included as an image on the page", 
etc.), and how confident you are in each extraction (e.g. "high confidence - clearly printed 
on the page", "medium confidence - it's a bit blurry but I think it says X", "low confidence
- it's very blurry and I'm not sure if it says X or Y").

If you don't see a field on this page, or you don't wish to override an existing extraction
with the information on this page, just leave the field null.

When recording where you found the information in the document, please record not only *where*
on the page you found it, but also *which page* it was on -- both the page number and also
a description of the page. Future iterations of the scanning process will read this blurb,
so you can't just say "the page" because they won't be shown the same page that you're
looking at now.
GOOD: "the introduction page of the document, which has a big heading that says 
    'Welcome to the Northwinds Shipping Corporation Supply Order Form'"
BAD: "the page", "the page with the big table", "a page" (with no further info)

Also include any notes about this page or the extraction process in general that you think
might be helpful for future iterations.
`);

    const jsonSchemaForExtraction = {
      name: `ocr_extract_structured_fields_from_page_${i + 1}`,
      description: `
Extract the structured fields we're looking for from page ${i + 1} of the document.
`,
      type: 'json_schema',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          discussion: {
            type: 'string',
            description: `
A discussion of what you see on this page that's relevant to the fields we're trying to extract,
any challenges you had in the extraction process, any contradictions you see between this page
and previous pages, and any other observations you have about this page in general.
This field is provided to facilitate chain-of-thought reasoning to enable you to provide
more thought-out answers for the rest of the fields in this object.
`,
          },
          fields: {
            type: 'object',
            properties: {},
            additionalProperties: false,
            required: [],
          } as any,
          notes_for_next_iterations: {
            type: 'string',
            description: `
Any notes that might be helpful for future iterations as we look through more pages of the document.
`,
          },
        },
        required: ['discussion', 'fields', 'notes_for_next_iterations'],
        additionalProperties: false,
      },
    };

    for (const [fieldName, fieldDescription] of Object.entries(
      fieldsToExtract
    )) {
      const fieldspec: any = {
        description:
          fieldDescription +
          ` (If you don't see this field on the page, or you don't want to override` +
          ` the already-extracted value of this field, then just set this` +
          ` response to null)`,
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            properties: {
              value: { type: 'string' },
              where_found_in_document: { type: 'string' },
              value_confidence: { type: 'string' },
            },
            required: ['value', 'where_found_in_document', 'value_confidence'],
            additionalProperties: false,
          },
        ],
      };
      jsonSchemaForExtraction.schema.properties.fields.properties[fieldName] =
        fieldspec;
      jsonSchemaForExtraction.schema.properties.fields.required.push(fieldName);
    }

    await convo.submit(undefined, undefined, {
      jsonResponse: { format: jsonSchemaForExtraction },
    });

    const iterNotesThisIteration = convo.getLastReplyDictField(
      'notes_for_next_iterations'
    );
    iterationNotes += `\n\nNotes from iteration ${i + 1}:\n${iterNotesThisIteration}`;

    const fieldsThisIteration: any = convo.getLastReplyDictField('fields');
    for (const [fieldName, fieldData] of Object.entries(
      fieldsThisIteration
    ) as [string, any][]) {
      if (fieldData) {
        // Update our master record of extractions so far with the new information from this iteration
        extractionsSoFar[fieldName] = {
          field_name: fieldName,
          field_value: fieldData.value,
          where_found_in_document: fieldData.where_found_in_document,
          value_confidence: fieldData.value_confidence,
        };
      }
    }

    console.log(convo.getLastReplyDict());
    console.log(
      `Extracted fields so far after iteration ${i + 1}:`,
      extractionsSoFar
    );
  }

  const retval: Record<string, string> = {};
  for (const [fieldName, extractionRecord] of Object.entries(
    extractionsSoFar
  )) {
    retval[fieldName] = extractionRecord.field_value;
  }
  return retval;
};
