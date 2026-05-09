const fs = require("fs/promises");
const path = require("path");

const DEFAULT_IMPORT_DIR = path.join(process.cwd(), "uploads", "curriculum-design");
let cachedPdfParse = null;

function cleanValue(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toSlug(value = "") {
  return cleanValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getPdfParse() {
  if (cachedPdfParse) return cachedPdfParse;
  try {
    // Lazy load so app boot does not fail when this optional parser dependency is absent.
    // The import endpoint will return a clear message instructing installation.
    // eslint-disable-next-line global-require
    cachedPdfParse = require("pdf-parse");
    return cachedPdfParse;
  } catch (_) {
    const error = new Error(
      "Missing dependency 'pdf-parse'. Run: npm install pdf-parse@1.1.1"
    );
    error.code = "MISSING_PDF_PARSE";
    throw error;
  }
}

function titleCase(value = "") {
  return cleanValue(value)
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeGradeLabel(raw = "") {
  const value = cleanValue(raw).toLowerCase();
  if (!value) return "";
  if (/(^|[\s-_])play[\s-_]?group($|[\s-_])/.test(value)) return "Play Group";
  if (/(^|[\s-_])pp[\s-_]?1($|[\s-_])|pre[\s-_]?primary[\s-_]?1/.test(value)) return "PP1";
  if (/(^|[\s-_])pp[\s-_]?2($|[\s-_])|pre[\s-_]?primary[\s-_]?2/.test(value)) return "PP2";
  const gradeMatch = value.match(/grade[\s-_]?(\d{1,2})/);
  if (gradeMatch) return `Grade ${gradeMatch[1]}`;
  const formMatch = value.match(/form[\s-_]?([34])/);
  if (formMatch) return `Form ${formMatch[1]}`;
  return titleCase(raw);
}

function resolveLevelKey(gradeLabel = "", fallbackText = "") {
  const normalized = normalizeGradeLabel(gradeLabel).toLowerCase();
  const fallback = cleanValue(fallbackText).toLowerCase();
  if (["play group", "pp1", "pp2"].includes(normalized)) return "pre-primary";
  if (/^grade [123]$/.test(normalized)) return "lower-primary";
  if (/^grade [456]$/.test(normalized)) return "upper-primary";
  if (/^grade [789]$/.test(normalized)) return "junior-secondary";
  if (/^grade (10|11|12)$/.test(normalized) || /^form [34]$/.test(normalized)) return "senior-secondary";
  if (fallback.includes("pre-primary")) return "pre-primary";
  if (fallback.includes("lower-primary")) return "lower-primary";
  if (fallback.includes("upper-primary")) return "upper-primary";
  if (fallback.includes("junior-secondary")) return "junior-secondary";
  if (fallback.includes("senior-secondary")) return "senior-secondary";
  return "";
}

function normalizePathway(raw = "") {
  const value = cleanValue(raw).toLowerCase();
  if (!value) return "";
  if (value.includes("stem")) return "STEM";
  if (value.includes("social")) return "Social Sciences";
  if (value.includes("arts") || value.includes("sport")) return "Arts & Sports Science";
  return titleCase(raw);
}

function normalizeLearningArea(raw = "") {
  const value = cleanValue(raw)
    .replace(/[_-]+/g, " ")
    .replace(/\s{2,}/g, " ");
  if (!value) return "";
  const upper = value.toUpperCase();
  if (upper === "KSL") return "KSL";
  if (upper === "CRE") return "CRE";
  if (upper === "IRE") return "IRE";
  if (upper === "HRE") return "HRE";
  return titleCase(value)
    .replace(/\bKsl\b/g, "KSL")
    .replace(/\bCre\b/g, "CRE")
    .replace(/\bIre\b/g, "IRE")
    .replace(/\bHre\b/g, "HRE");
}

async function collectPdfFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      const nested = await collectPdfFiles(absolutePath);
      results.push(...nested);
      // eslint-disable-next-line no-continue
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      results.push(absolutePath);
    }
  }
  return results;
}

function normalizeLine(line = "") {
  return cleanValue(
    String(line || "")
      .replace(/[•·]/g, " ")
      .replace(/\s+/g, " ")
  );
}

function cleanTopicName(rawTopic = "") {
  return cleanValue(
    String(rawTopic || "")
      .replace(/[•·]+/g, " ")
      .replace(/\b(Core|Competencies?|Competency|Value|Values)\b.*$/i, "")
      .replace(/^[,:;\-]+/, "")
  );
}

function parseTopicLine(line = "", topicType = "strand") {
  const normalizedTopicType = topicType === "sub" ? "(?:sub\\s*[-.]?\\s*strand|sub)" : "strand";
  const regex = new RegExp(`^${normalizedTopicType}\\s*([0-9]+(?:\\.[0-9]+)*)?\\s*[:\\-]?\\s*(.*)$`, "i");
  const match = cleanValue(line).match(regex);
  if (!match) return null;
  const code = cleanValue(match[1] || "");
  const name = cleanTopicName(match[2] || "");
  if (!code && !name) return null;
  return {
    code,
    name: cleanValue([code, name].filter(Boolean).join(" "))
  };
}

function appendNarrative(existing = "", line = "") {
  const cleaned = cleanValue(line);
  if (!cleaned || cleaned.length < 3) return cleanValue(existing);
  const current = cleanValue(existing);
  if (!current) return cleaned;
  if (current.toLowerCase().includes(cleaned.toLowerCase())) return current;
  return `${current}\n${cleaned}`;
}

function buildRowKey(parts = []) {
  return parts
    .map((item) => cleanValue(item).toLowerCase())
    .join("::");
}

function extractRowsFromPdfText(text = "") {
  const rowsByKey = new Map();
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeLine(line))
    .filter(Boolean);
  let currentStrand = "";
  let currentSubStrand = "";
  let pendingTopic = null;
  let captureMode = null;
  const stopCaptureRegex = /key inquiry|assessment|values?|competenc|resources?|links? to|core competencies/i;

  const ensureRow = () => {
    if (!currentStrand || !currentSubStrand) return null;
    const key = buildRowKey([currentStrand, currentSubStrand]);
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        strand: cleanValue(currentStrand),
        sub_strand: cleanValue(currentSubStrand),
        learning_outcomes: "",
        learning_experiences: ""
      });
    }
    return rowsByKey.get(key);
  };

  lines.forEach((line) => {
    if (/^strand$/i.test(line)) {
      pendingTopic = "strand";
      captureMode = null;
      return;
    }
    if (/^(sub|sub\s*[-.]?\s*strand)$/i.test(line)) {
      pendingTopic = "sub";
      captureMode = null;
      return;
    }
    const strandTopic = parseTopicLine(line, "strand");
    if (strandTopic?.name) {
      currentStrand = strandTopic.name;
      pendingTopic = null;
      captureMode = null;
      ensureRow();
      return;
    }
    const subTopic = parseTopicLine(line, "sub");
    if (subTopic?.name) {
      currentSubStrand = subTopic.name;
      pendingTopic = null;
      captureMode = null;
      ensureRow();
      return;
    }
    if (pendingTopic === "strand" && !/specific|suggested|outcomes?|experiences?/i.test(line)) {
      const topic = cleanTopicName(line);
      if (topic) currentStrand = topic;
      pendingTopic = null;
      captureMode = null;
      ensureRow();
      return;
    }
    if (pendingTopic === "sub" && !/specific|suggested|outcomes?|experiences?/i.test(line)) {
      const topic = cleanTopicName(line);
      if (topic) currentSubStrand = topic;
      pendingTopic = null;
      captureMode = null;
      ensureRow();
      return;
    }

    // Common CBC numbering patterns (for example: 1.1.1 Oral skills)
    if (/^\d+\.\d+\.\d+\s+/.test(line)) {
      currentSubStrand = cleanTopicName(line);
      captureMode = null;
      ensureRow();
      return;
    }
    if (/^\d+\.\d+\s+/.test(line) && !currentStrand) {
      currentStrand = cleanTopicName(line);
      captureMode = null;
      ensureRow();
      return;
    }

    if (/specific\s+(learning\s+)?outcomes?/i.test(line)) {
      captureMode = "outcomes";
      ensureRow();
      return;
    }
    if (/suggested\s+(learning\s+)?experiences?/i.test(line)) {
      captureMode = "experiences";
      ensureRow();
      return;
    }
    if (stopCaptureRegex.test(line)) {
      captureMode = null;
      return;
    }
    if (!captureMode) return;
    const row = ensureRow();
    if (!row) return;
    if (captureMode === "outcomes") {
      row.learning_outcomes = appendNarrative(row.learning_outcomes, line);
      return;
    }
    row.learning_experiences = appendNarrative(row.learning_experiences, line);
  });

  return Array.from(rowsByKey.values())
    .map((row) => ({
      strand: cleanValue(row.strand),
      sub_strand: cleanValue(row.sub_strand),
      learning_outcomes: cleanValue(row.learning_outcomes),
      learning_experiences: cleanValue(row.learning_experiences)
    }))
    .filter((row) => row.strand && row.sub_strand);
}

function extractMetadataFromPath(filePath, baseDirectory) {
  const relative = path.relative(baseDirectory, filePath);
  const segments = relative.split(path.sep).map((segment) => cleanValue(segment)).filter(Boolean);
  const fileName = cleanValue(path.basename(filePath, ".pdf"));
  const parts = fileName.split("__").map((item) => cleanValue(item)).filter(Boolean);
  const folderHint = segments.join(" ");
  const detectedGrade = normalizeGradeLabel(
    parts[0]
      || segments.find((segment) => /(grade|pp|play|form)/i.test(segment))
      || ""
  );
  let learningArea = "";
  let pathway = "";
  if (parts.length >= 3) {
    pathway = normalizePathway(parts[1]);
    learningArea = normalizeLearningArea(parts.slice(2).join(" "));
  } else if (parts.length >= 2) {
    learningArea = normalizeLearningArea(parts[1]);
  } else {
    learningArea = normalizeLearningArea(fileName);
  }
  if (!pathway) {
    const folderPathway = segments.find((segment) => /(stem|social|arts|sport)/i.test(segment));
    pathway = normalizePathway(folderPathway || "");
  }
  const levelKey = resolveLevelKey(detectedGrade, folderHint);
  return {
    source_file_path: relative,
    source_document: path.basename(filePath),
    grade_label: detectedGrade || "",
    level_key: levelKey || "",
    level_label: titleCase((levelKey || "").replace(/-/g, " ")),
    pathway: pathway || "",
    learning_area: learningArea || ""
  };
}

async function extractRowsFromSinglePdf(filePath, metadata) {
  const pdfParse = getPdfParse();
  const buffer = await fs.readFile(filePath);
  const parsed = await pdfParse(buffer);
  const rows = extractRowsFromPdfText(parsed?.text || "");
  return rows.map((row) => ({
    ...row,
    grade_label: metadata.grade_label,
    level_key: metadata.level_key,
    level_label: metadata.level_label,
    pathway: metadata.pathway,
    learning_area: metadata.learning_area,
    source_document: metadata.source_document,
    source_file_path: metadata.source_file_path
  }));
}

async function importLocalCurriculumFromPdfDirectory(options = {}) {
  const baseDirectory = path.resolve(cleanValue(options.base_directory) || DEFAULT_IMPORT_DIR);
  const maxFiles = Math.min(Math.max(Number(options.max_files || 500), 1), 5000);
  const entries = await fs.readdir(baseDirectory, { withFileTypes: true }).catch(() => []);
  if (!entries.length) {
    return {
      base_directory: baseDirectory,
      scanned_file_count: 0,
      parsed_file_count: 0,
      extracted_row_count: 0,
      unique_row_count: 0,
      rows: [],
      file_summaries: [],
      file_errors: [
        { file: baseDirectory, error: "No files found. Ensure PDFs exist in the provided folder." }
      ]
    };
  }
  const pdfFiles = (await collectPdfFiles(baseDirectory)).slice(0, maxFiles);
  const extractedRows = [];
  const fileSummaries = [];
  const fileErrors = [];

  for (const filePath of pdfFiles) {
    const metadata = extractMetadataFromPath(filePath, baseDirectory);
    try {
      // eslint-disable-next-line no-await-in-loop
      const rows = await extractRowsFromSinglePdf(filePath, metadata);
      extractedRows.push(...rows);
      fileSummaries.push({
        source_document: metadata.source_document,
        grade_label: metadata.grade_label,
        learning_area: metadata.learning_area,
        pathway: metadata.pathway || null,
        extracted_rows: rows.length
      });
    } catch (error) {
      fileErrors.push({
        file: metadata.source_document,
        source_file_path: metadata.source_file_path,
        error: error.message
      });
    }
  }

  const mergedMap = new Map();
  extractedRows.forEach((row) => {
    const key = buildRowKey([row.grade_label, row.learning_area, row.strand, row.sub_strand]);
    if (!mergedMap.has(key)) {
      mergedMap.set(key, { ...row });
      return;
    }
    const existing = mergedMap.get(key);
    existing.learning_outcomes = appendNarrative(existing.learning_outcomes, row.learning_outcomes);
    existing.learning_experiences = appendNarrative(existing.learning_experiences, row.learning_experiences);
  });

  return {
    base_directory: baseDirectory,
    scanned_file_count: pdfFiles.length,
    parsed_file_count: fileSummaries.length,
    extracted_row_count: extractedRows.length,
    unique_row_count: mergedMap.size,
    rows: Array.from(mergedMap.values()),
    file_summaries: fileSummaries,
    file_errors: fileErrors
  };
}

module.exports = {
  importLocalCurriculumFromPdfDirectory,
  normalizeGradeLabel,
  resolveLevelKey,
  normalizePathway,
  normalizeLearningArea,
  toSlug
};
