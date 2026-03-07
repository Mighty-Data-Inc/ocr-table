import { GPT_MODEL_VISION } from '@mightydatainc/gpt-conversation';
import {
  ConversationMessage,
  GptConversation,
} from '@mightydatainc/gpt-conversation';
import { JSONSchemaFormat } from '@mightydatainc/gpt-conversation';
import { OcrTable } from './records.js';
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

  for (let i = 0; i < pagesAsPngBuffers.length; i++) {
    const pageBuffer = pagesAsPngBuffers[i];
    const pageBufferPrevious = i > 0 ? pagesAsPngBuffers[i - 1] : null;

    const convo = convoBase.clone();

    convo.addDeveloperMessage(`
Here is page ${i + 1} of the document:
`);
    convo.addImage(
      'user',
      `Here is page ${i + 1} of the document:`,
      `data:image/png;base64,${pageBuffer.toString('base64')}`
    );

    if (pageBufferPrevious) {
      convo.addDeveloperMessage(`
For the sake of context (in case any crucial information is split across a 
page break), here is the previous page (${i}) as well:
`);
      convo.addImage(
        'user',
        `Here is the previous page (${i}) for context:`,
        `data:image/png;base64,${pageBufferPrevious.toString('base64')}`
      );
    }

    // TODO: Perform OCR field extraction
  }

  return {};
};
