"use strict";

/**
 * Optional OpenAI-powered MCQ stems (Kenyan CBC). Requires OPENAI_API_KEY.
 * Falls back silently when the key is missing or the request fails.
 */

const cleanValue = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

function buildCurriculumExcerpt(referenceRows, maxLen = 10000) {
  const parts = [];
  let joined = "";
  const rows = Array.isArray(referenceRows) ? referenceRows : [];
  for (const row of rows.slice(0, 45)) {
    const chunk = [
      row?.strand,
      row?.sub_strand,
      row?.notes,
      row?.learning_experiences,
      row?.specific_learning_outcomes
    ]
      .filter(Boolean)
      .join(" | ");
    if (chunk.length > 24) {
      parts.push(chunk.replace(/\s+/g, " ").trim().slice(0, 1400));
      joined = parts.join("\n");
      if (joined.length >= maxLen) break;
    }
  }
  return joined.slice(0, maxLen);
}

function extractJsonObject(text) {
  const t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const inner = fence ? fence[1] : t;
  try {
    return JSON.parse(inner);
  } catch {
    const i = inner.indexOf("{");
    const j = inner.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(inner.slice(i, j + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * @returns {Promise<string[]>}
 */
async function generateExamStemsWithOpenAi({
  learningArea,
  gradeOrForm,
  referenceRows,
  maxStems = 42
}) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return [];
  }

  const excerpt = buildCurriculumExcerpt(referenceRows);
  if (excerpt.length < 80) {
    return [];
  }

  const model = cleanValue(process.env.EXAM_OPENAI_MODEL) || "gpt-4o-mini";
  const count = Math.min(45, Math.max(10, Number(maxStems) || 42));

  const userPrompt = [
    "You are an expert Kenyan CBC junior-secondary assessment item writer.",
    `Learning area: ${cleanValue(learningArea) || "General"}.`,
    `Level / grade or form: ${cleanValue(gradeOrForm) || "not specified"}.`,
    `Using ONLY the curriculum notes below as the knowledge base, write ${count} distinct multiple-choice question stems.`,
    "Each stem must be ONE clear sentence ending with a question.",
    "Do NOT mention strand, sub-strand, syllabus numbering, or catalogue headings in the stem.",
    "Do not include answer choices (A–D) or the correct answer in the stem text.",
    "Vary cognitive demand across items: recall, understanding, application, brief analysis.",
    `Respond with a JSON object ONLY, shape: {"stems":["stem1","stem2",...]} with exactly ${count} strings in "stems".`,
    "--- CURRICULUM CONTEXT ---",
    excerpt
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.85,
      max_tokens: Math.min(8000, count * 140 + 220),
      messages: [
        {
          role: "system",
          content:
            'Reply with a single JSON object only. The object must have key "stems" whose value is an array of strings. No markdown outside JSON.'
        },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    // eslint-disable-next-line no-console
    console.warn("[exam-ai] OpenAI HTTP", res.status, errText.slice(0, 400));
    return [];
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content || "";
  const parsed = extractJsonObject(content);
  const stems = parsed?.stems;
  if (!Array.isArray(stems)) {
    return [];
  }

  return stems
    .map((s) =>
      cleanValue(String(s || ""))
        .replace(/^\d+[\).\s]+/, "")
        .slice(0, 420)
    )
    .filter((s) => s.length > 18)
    .slice(0, count);
}

module.exports = { generateExamStemsWithOpenAi, buildCurriculumExcerpt };
