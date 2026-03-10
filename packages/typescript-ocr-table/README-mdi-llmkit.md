# Integrating AI into Zacks Analytics Systems

_A Practical Approach Using the Mighty Data LLM Kit_

---

# 1. The Problem: Free-Form LLM Responses Break Deterministic Workflows

Teams like Zacks need deterministic, auditable, structured outputs that plug into existing procedural software pipelines. The core problem is that LLMs naturally return probabilistic free-form text, which creates integration risk, brittle post-processing logic, and high maintenance overhead.

## 1.1 Free-Form Text vs Structured Systems

Large language models are powerful tools. They are very good at reading text, summarizing information, and reasoning about language.

However, they have one major limitation: **they naturally produce free-form text**.

Software systems, on the other hand, require **structured data**.

This mismatch creates difficulties when developers attempt to integrate LLMs into existing analytics systems.

In practice, engineers often end up spending most of their time writing:

- parsers
- regex cleanup
- defensive code to handle malformed output
- increasingly elaborate prompts designed to force the model to emit structured data

What begins as “AI integration” quickly becomes an exercise in pleading with the model:

> Please output valid JSON.
> Do not include commentary.
> Do not wrap the JSON in markdown.
> Please do not add extra fields.
> Please just output the JSON.

Developers sometimes refer to this process as **“prompt engineering.”**

In reality, it often looks more like begging, threatening, and bribing the AI to behave.

This approach is brittle and time-consuming.

A more reliable solution is to provide **software tools that enforce structure directly**, rather than trying to coerce the model through prompts.

---

## 1.2 A Better Approach

The **Mighty Data LLM Kit** provides several small tools designed to make LLMs behave more like normal components inside a software system.

These tools are not intended to form a rigid pipeline. They are **independent utilities** that can be used wherever they solve a particular problem.

An analogy is helpful here.

Think of these components as tools in a toolbox:

- a wrench
- a screwdriver
- a hammer

Each tool solves a different type of problem. They are not meant to be used in a fixed sequence.

The key components discussed in this report are:

- **GptConversation**
- **JSONSchemaFormat**
- **jsonSurgery**
- **semantic_match**

Together, these tools help developers integrate LLMs into procedural systems without relying on fragile prompt tricks.

---

## 1.3 Design Philosophy

The guiding idea behind this toolkit is simple:

> LLMs should behave like components inside a software system, not like chatbots.

This means:

- outputs should be predictable
- data should be structured
- workflows should be debuggable
- prompt instructions should be minimal

When these principles are followed, LLMs become much easier to integrate into existing analytics pipelines.

---

# 2. Core Components of the Mighty Data LLM Kit

## 2.1 GptConversation

Most LLM integrations rely on single prompts.

This approach works for simple tasks, but it quickly becomes fragile when systems grow more complex.

Real workflows often require:

- multiple reasoning steps
- structured outputs
- retries when a response fails
- comparing multiple candidate answers

**GptConversation** provides a structured way to manage these interactions.

It allows developers to maintain conversation state and submit prompts through a controlled interface.

A simple example:

```python
from openai import OpenAI
from mightydatainc_gpt_conversation import GptConversation

client = OpenAI()

conversation = GptConversation(openai_client=client)

conversation.submit_user_message(
    "Write a short summary of Apple's latest earnings call."
)

conversation.submit(shotgun=3)

summary = conversation.get_last_reply_str()
print(summary)
```

The `shotgun` parameter instructs the system to generate multiple candidate responses and select the best one.

This technique often produces better results than relying on a single model output.

---

## 2.2 JSONSchemaFormat

Even when asked for JSON, LLMs frequently produce malformed structures.

Developers typically respond by writing additional parsing code or adding more instructions to the prompt.

**JSONSchemaFormat** solves this problem directly.

Instead of asking the model for JSON, the developer defines a schema describing the expected output.

Example:

```python
from mightydatainc_gpt_conversation.json_schema_format import JSONSchemaFormat

conversation.submit(
    json_response=JSONSchemaFormat({
        "company_name": str,
        "ticker": str,
        "sentiment": ("positive | negative")
    })
)
```

The model must return data that conforms to this structure.

The result can be consumed immediately by the program as structured data.

This eliminates the need for fragile parsing logic.

---

## 2.3 jsonSurgery

Another common problem occurs when an LLM is asked to modify an existing structured object.

Developers often ask the model to regenerate the entire object with one small change.

This approach frequently leads to errors such as:

- missing fields
- extra fields
- altered data structures

**jsonSurgery** takes a different approach.

Instead of rewriting the entire object, it performs **targeted semantic edits**.

Example:

```python
from openai import OpenAI
from mightydatainc_json_surgery import jsonSurgery

client = OpenAI()

research_record = {
    "ticker": "NVDA",
    "sentiment": "positive",
    "catalysts": [
        "Demand for AI chips continues to surge across cloud providers.",
        "New GPU architecture launches later this year could drive another upgrade cycle.",
        "Major hyperscalers are expanding data center capacity."
    ],
    "risks": [
        "US export restrictions on advanced chips to China",
        "Possible tightening of AI chip export rules by regulators"
    ]
}

instructions = """
Rewrite each item in the catalysts list as a short noun phrase.

Add a new field called "risk_class".

Set risk_class to one of the following enum values:

REGULATORY
COMPETITION
MACRO
SUPPLY_CHAIN
TECHNOLOGY
VALUATION

Choose the value that best summarizes the main risk described in the risks list.
"""

updated_record = jsonSurgery(
    obj=research_record,
    instructions=instructions,
    openai_client=client
)

print(updated_record)
```

Example result:

```python
{
    "ticker": "NVDA",
    "sentiment": "positive",
    "catalysts": [
        "surging AI chip demand",
        "next-generation GPU launch",
        "hyperscaler data center expansion"
    ],
    "risks": [
        "US export restrictions on advanced chips to China",
        "possible tightening of AI chip export rules"
    ],
    "risk_class": "REGULATORY"
}
```

This example demonstrates semantic transformation, schema augmentation, and reasoning over existing fields — all without rewriting the entire object.

---

## 2.4 semantic_match

Many analytics workflows require mapping ambiguous text to known values.

For example, a report might refer to a company using slightly different wording than the canonical name stored in a database.

**semantic_match** helps resolve these differences.

Instead of performing exact string matching, it finds the closest semantic match within a list of known values.

---

# 3. Putting It All Together: Example Use Case for Zacks

Consider a simple example involving analyst reports.

1. A text report arrives from an analyst.
2. The system extracts structured information using **GptConversation** and **JSONSchemaFormat**.
3. The system queries the database for a list of known companies.
4. **semantic_match** identifies which company the report refers to.
5. The report is inserted into a database keyed by the ticker symbol.

A Python script to perform this sequence of operations would look something like this:

```python
from pathlib import Path

from openai import OpenAI
from pymongo import MongoClient
from mightydatainc_gpt_conversation import GptConversation, JSONSchemaFormat
from mightydatainc_semantic_match import find_semantic_match

openai_client = OpenAI()
conversation = GptConversation(openai_client)

# This method doesn't actually send any data to the LLM yet. It merely adds
# this message to the conversation sequence.
conversation.add_system_message(
    "The user will show you a quarterly earnings report from a company." +
    "You will read the report and then fill out a structured questionnaire."
)

# Read the raw text of a report from a file
report_text = Path("incoming_reports/SSNG_2026_q1.txt").read_text(encoding="utf-8")

# add_* methods only queue messages in the conversation and do not call the LLM.
conversation.add_user_message(report_text)

# submit* methods perform the actual LLM call. This call will take a few seconds.
# Submit the structured output query to the LLM.
# It will be able to infer the meaning of most of these fields just by their field names
# and data types alone. If there's any uncertainty or ambiguity, we can set the values
# of the fields to be tuples that contain descriptions, which provide additional
# explanation and context to the AI.
# The model handles retries/timeouts internally.
# The optional "shotgun" argument launches parallel workers and reconciles their outputs
# into a single coherent response. It burns more tokens and takes a bit more time,
# but is a useful trick for improving the reliability of the output in situations in which
# the LLM might struggle, or where correctness is of paramount importance.
conversation.submit(
    json_response=JSONSchemaFormat({
        "company_name": str,
        "ticker": str,
        "sentiment": (
            ["positive", "negative", "neutral"],
            "The sentiment that the report expresses about the company."
        ),
        "report_title": str,
        "report_summary": str
    }),
    shotgun=3,
)

# Get the AI's reply as a Python dict.
report_data = conversation.get_last_reply_dict()

report_company_name = report_data["company_name"]
report_company_ticker = report_data["ticker"]
report_company_str = f"{report_company_name} (ticker: {report_company_ticker})"

report_sentiment = report_data["sentiment"]
report_title = report_data["report_title"]
report_summary = report_data["report_summary"]

# The company name, as parsed from the report, probably isn't a perfect match to our
# canonical DB representation. That's okay!
# Suppose we have a companies collection with canonical company name, ticker,
# and an internal company ID (_id). Query these values into a list.
mongo_client = MongoClient("mongodb://localhost:27017")
db = mongo_client["zacks_analytics"]
company_records_list = list(db.companies.find({}, {"_id": 1, "name": 1, "ticker": 1}))

company_fuzzy_match_list = [f"{c['name']} (ticker: {c['ticker']})" for c in company_records_list]

# This performs a submission to the LLM. This call will take a few seconds, and will
# include its own timeout and retry handling.
company_match_index = find_semantic_match(
    openai_client,
    company_fuzzy_match_list,
    report_company_str
)

if company_match_index == -1:
    raise ValueError(f"Report is about an unrecognized company: {report_company_str}")

matched_company_record = company_records_list[company_match_index]
matched_company_id = matched_company_record["_id"]

# Insert into a reports collection.
db.reports.insert_one({
    "company_id": matched_company_id,
    "ticker": report_company_ticker,
    "sentiment": report_sentiment,
    "title": report_title,
    "summary": report_summary,
    "source_text": report_text,
})

print(f"Saved report: {report_company_str} -- sentiment: {report_sentiment}")
```

The report can then be stored in a database using the matched ticker symbol and sentiment classification.

This example illustrates how traditional systems and LLM tools can work together inside a structured workflow.

---

# 4. Why This Approach Works

This approach avoids many of the common pitfalls of LLM integration.

Key advantages include:

- structured outputs instead of free-form text
- fewer fragile prompt instructions
- easier debugging
- natural integration with Python systems
- support for experimentation without breaking existing pipelines

Most importantly, it allows developers to treat LLMs as **reliable components inside software systems**.

---

# 5. Conclusion

Large language models are powerful tools, but integrating them into structured analytics environments requires careful engineering.

The Mighty Data LLM Kit provides a set of practical utilities that help solve common integration problems.

By combining structured conversation workflows, schema-enforced outputs, semantic JSON edits, and intelligent text matching, organizations like Zacks can incorporate AI capabilities into their analytics systems without sacrificing reliability.

The goal is not to build chatbots.

The goal is to make LLMs behave like dependable components inside real software systems.
