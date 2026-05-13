const KICD_BASE_URL = "https://kicd.ac.ke";

const KICD_LEVEL_PAGES = [
  { slug: "pre-primary", level_label: "Pre-Primary", default_grade_label: "PP1-PP2" },
  { slug: "lower-primary", level_label: "Lower Primary", default_grade_label: "Grade 1-3" },
  { slug: "grade-four-designs", level_label: "Grade Four", default_grade_label: "Grade 4" },
  { slug: "grade-five-designs", level_label: "Grade Five", default_grade_label: "Grade 5" },
  { slug: "grade-six-designs", level_label: "Grade Six", default_grade_label: "Grade 6" },
  { slug: "grade-seven-designs", level_label: "Grade Seven", default_grade_label: "Grade 7" },
  { slug: "grade-eight-designs", level_label: "Grade Eight", default_grade_label: "Grade 8" },
  { slug: "grade-nine-designs", level_label: "Grade Nine", default_grade_label: "Grade 9" },
  { slug: "grade-ten", level_label: "Grade Ten", default_grade_label: "Grade 10" },
  { slug: "grade-eleven", level_label: "Grade Eleven", default_grade_label: "Grade 11" },
  { slug: "grade-twelve", level_label: "Grade Twelve", default_grade_label: "Grade 12" }
];

function stripResponsePrefix(raw) {
  return String(raw || "").replace(/^\)\]\}'\s*/, "");
}

function cleanValue(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#039;", "'")
    .replaceAll("&#8211;", "-")
    .replaceAll("&#8217;", "'")
    .replaceAll("&#8220;", "\"")
    .replaceAll("&#8221;", "\"")
    .replaceAll("&nbsp;", " ");
}

function normalizeOcrLine(line) {
  return cleanValue(
    String(line || "")
      .replace(/[•·]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

async function fetchText(url, timeoutMs = 30000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; IMIS-KICD-Importer/1.0)"
    }
  });
  if (!response.ok) {
    throw new Error(`KICD request failed (${response.status}) for ${url}`);
  }
  return response.text();
}

async function fetchJson(url, timeoutMs = 30000) {
  const text = await fetchText(url, timeoutMs);
  return JSON.parse(stripResponsePrefix(text));
}

function extractDriveFileId(url) {
  const match = String(url || "").match(/\/file\/d\/([^/]+)\/preview/i);
  return cleanValue(match?.[1] || "");
}

function deriveGradeLabel({ heading2, heading3, fallbackGrade }) {
  const h3 = cleanValue(heading3);
  const h2 = cleanValue(heading2);
  if (/^pre-primary\s*1$/i.test(h3)) return "PP1";
  if (/^pre-primary\s*2$/i.test(h3)) return "PP2";
  if (/^grade\s*\d+/i.test(h3)) return h3;
  if (/^grade\s*\d+/i.test(h2)) return h2;
  if (h2) return h2;
  return cleanValue(fallbackGrade);
}

function deriveLearningArea({ heading2, heading3, fallbackLearningArea }) {
  const h3 = cleanValue(heading3);
  if (h3) return h3;
  const h2 = cleanValue(heading2);
  if (h2) return h2;
  return cleanValue(fallbackLearningArea || "General");
}

function parseCatalogDocumentsFromRenderedHtml(renderedHtml, pageConfig) {
  const html = decodeHtml(renderedHtml || "");
  const regex = /<h([23])[^>]*>(.*?)<\/h\1>|<iframe[^>]*src="([^"]+)"/gim;
  let match;
  let currentH2 = "";
  let currentH3 = "";
  const documents = [];
  while ((match = regex.exec(html)) !== null) {
    const headingLevel = match[1];
    const headingText = cleanValue(String(match[2] || "").replace(/<[^>]+>/g, ""));
    const iframeSrc = cleanValue(match[3]);
    if (headingLevel && headingText) {
      if (headingLevel === "2") currentH2 = headingText;
      if (headingLevel === "3") currentH3 = headingText;
      // Continue; a subsequent iframe normally belongs to this heading.
      // eslint-disable-next-line no-continue
      continue;
    }
    if (!iframeSrc) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const fileId = extractDriveFileId(iframeSrc);
    if (!fileId) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const gradeLabel = deriveGradeLabel({
      heading2: currentH2,
      heading3: currentH3,
      fallbackGrade: pageConfig.default_grade_label
    });
    const learningArea = deriveLearningArea({
      heading2: currentH2,
      heading3: currentH3,
      fallbackLearningArea: pageConfig.level_label
    });
    documents.push({
      level_key: pageConfig.slug,
      level_label: pageConfig.level_label,
      grade_label: gradeLabel,
      learning_area: learningArea,
      source_heading_h2: cleanValue(currentH2),
      source_heading_h3: cleanValue(currentH3),
      source_preview_url: iframeSrc,
      source_file_id: fileId
    });
  }
  return documents;
}

async function fetchKicdCatalog(options = {}) {
  const includeLevels = Array.isArray(options.includeLevels)
    ? options.includeLevels.map((item) => cleanValue(item).toLowerCase()).filter(Boolean)
    : [];
  const levelPages = includeLevels.length
    ? KICD_LEVEL_PAGES.filter((page) => includeLevels.includes(page.slug))
    : KICD_LEVEL_PAGES;
  const documents = [];
  const levelErrors = [];
  for (const page of levelPages) {
    try {
      const endpoint = `${KICD_BASE_URL}/wp-json/wp/v2/pages?slug=${encodeURIComponent(page.slug)}`;
      // eslint-disable-next-line no-await-in-loop
      const rows = await fetchJson(endpoint, 30000);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) {
        levelErrors.push({ slug: page.slug, error: "No page row returned." });
        // eslint-disable-next-line no-continue
        continue;
      }
      const rendered = row?.content?.rendered || "";
      const parsed = parseCatalogDocumentsFromRenderedHtml(rendered, page);
      documents.push(...parsed);
    } catch (error) {
      levelErrors.push({ slug: page.slug, error: error.message });
    }
  }
  return {
    level_count: levelPages.length,
    document_count: documents.length,
    documents,
    level_errors: levelErrors
  };
}

function decodeDriveEscapedUrl(value) {
  return String(value || "")
    .replaceAll("\\u003d", "=")
    .replaceAll("\\u0026", "&")
    .replaceAll("\\/", "/");
}

async function buildDriveViewerSession(fileId) {
  const previewUrl = `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
  const previewHtml = await fetchText(previewUrl, 30000);
  const titleMatch = previewHtml.match(/<title>([^<]+)<\/title>/i);
  const sourceTitle = cleanValue(titleMatch?.[1] || "");
  const uploadMatch = previewHtml.match(/https:\/\/drive\.google\.com\/viewer\/upload\?ds\\u003d[^"']+/);
  if (!uploadMatch) {
    throw new Error("Could not resolve drive upload endpoint from preview HTML.");
  }
  const uploadUrl = decodeDriveEscapedUrl(uploadMatch[0]);
  const uploadResponseText = await fetchText(uploadUrl, 30000);
  const uploadPayload = JSON.parse(stripResponsePrefix(uploadResponseText));
  const metaPath = cleanValue(uploadPayload?.meta || "");
  const pressPagePath = cleanValue(uploadPayload?.presspage || "");
  if (!metaPath || !pressPagePath) {
    throw new Error("Drive upload response did not include meta/presspage endpoints.");
  }
  return {
    source_title: sourceTitle,
    meta_url: `https://drive.google.com/viewer/${metaPath}`,
    presspage_base_url: `https://drive.google.com/viewer/${pressPagePath}`
  };
}

function collectWordsFromPressNode(node, out = []) {
  if (Array.isArray(node)) {
    if (node.length === 2 && Array.isArray(node[0]) && typeof node[1] === "string") {
      const [x = 0, y = 0] = node[0];
      out.push({ x: Number(x) || 0, y: Number(y) || 0, text: node[1] });
      return out;
    }
    node.forEach((child) => collectWordsFromPressNode(child, out));
  }
  return out;
}

function convertPressPayloadToLines(pressPayload) {
  const words = collectWordsFromPressNode(pressPayload);
  words.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  words.forEach((word) => {
    let row = rows.find((entry) => Math.abs(entry.y - word.y) <= 2);
    if (!row) {
      row = { y: word.y, words: [] };
      rows.push(row);
    }
    row.words.push(word);
  });
  rows.sort((a, b) => a.y - b.y);
  return rows
    .map((row) => row.words.sort((a, b) => a.x - b.x).map((word) => word.text).join(" "))
    .map((line) => normalizeOcrLine(line))
    .filter(Boolean);
}

function cleanTopicName(rawTopic) {
  return cleanValue(
    String(rawTopic || "")
      .replace(/[•·]+/g, " ")
      .replace(/\b(Core|Competencies?|Competency|Value|Values)\b.*$/i, "")
      .replace(/\s{2,}/g, " ")
      .replace(/^[,:;\-]+/, "")
      .trim()
  );
}

function parseTopicLine(line, topicType) {
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

function buildKey(gradeLabel, learningArea, strand, subStrand) {
  return [gradeLabel, learningArea, strand, subStrand]
    .map((item) => cleanValue(item).toLowerCase())
    .join("::");
}

function appendNarrative(existing, line) {
  const cleaned = cleanValue(line);
  if (!cleaned || cleaned.length < 3) return existing;
  const current = cleanValue(existing);
  if (!current) return cleaned;
  if (current.toLowerCase().includes(cleaned.toLowerCase())) return current;
  return `${current}\n${cleaned}`;
}

function extractCurriculumRowsFromOcrLines(lines) {
  const rowsByKey = new Map();
  let currentStrand = "";
  let currentSubStrand = "";
  let pendingTopic = null;
  let captureMode = null;

  const resetCaptureForHeading = () => {
    captureMode = null;
  };

  const ensureRow = (gradeLabel, learningArea, sourceDocument) => {
    const key = buildKey(gradeLabel, learningArea, currentStrand, currentSubStrand);
    if (!currentStrand || !currentSubStrand) return null;
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        grade_label: gradeLabel,
        learning_area: learningArea,
        strand: currentStrand,
        sub_strand: currentSubStrand,
        learning_outcomes: "",
        learning_experiences: "",
        source_document: sourceDocument
      });
    }
    return rowsByKey.get(key);
  };

  lines.forEach((rawLine) => {
    const line = normalizeOcrLine(rawLine);
    if (!line) return;

    if (/^strand$/i.test(line)) {
      pendingTopic = "strand";
      resetCaptureForHeading();
      return;
    }
    if (/^(sub|sub\s*[-.]?\s*strand)$/i.test(line)) {
      pendingTopic = "sub";
      resetCaptureForHeading();
      return;
    }

    const strandTopic = parseTopicLine(line, "strand");
    if (strandTopic?.name) {
      currentStrand = strandTopic.name;
      if (/sub\s*[-.]?\s*strand/i.test(line)) {
        // Avoid overwriting when OCR fuses multiple columns.
      } else {
        resetCaptureForHeading();
        pendingTopic = null;
        return;
      }
    }

    const subTopic = parseTopicLine(line, "sub");
    if (subTopic?.name) {
      currentSubStrand = subTopic.name;
      resetCaptureForHeading();
      pendingTopic = null;
      return;
    }

    if (pendingTopic === "strand" && !/specific|suggested|outcomes?|experiences?/i.test(line)) {
      const topic = cleanTopicName(line);
      if (topic) currentStrand = topic;
      pendingTopic = null;
      return;
    }
    if (pendingTopic === "sub" && !/specific|suggested|outcomes?|experiences?/i.test(line)) {
      const topic = cleanTopicName(line);
      if (topic) currentSubStrand = topic;
      pendingTopic = null;
      return;
    }

    if (/specific\s+(learning\s+)?outcomes?|specific outcomes by/i.test(line)) {
      captureMode = "outcomes";
      return;
    }
    if (/suggested\s+(learning\s+)?experiences?/i.test(line)) {
      captureMode = "experiences";
      return;
    }
    if (/key inquiry|assessment|values?|competenc|pertinent|contemporary|resource|link to/i.test(line)) {
      resetCaptureForHeading();
      return;
    }

    if (captureMode && /^(a\)|b\)|c\)|d\)|e\)|f\)|g\)|h\)|i\)|ii|iii|iv)$/i.test(line)) {
      return;
    }

    if (captureMode && /^(this\s+)?sub\s*strand[, ]/i.test(line)) {
      return;
    }

    if (captureMode) {
      // Caller will resolve grade/learning area/source fields later.
      const key = buildKey("", "", currentStrand, currentSubStrand);
      if (!currentStrand || !currentSubStrand) return;
      if (!rowsByKey.has(key)) {
        rowsByKey.set(key, {
          grade_label: "",
          learning_area: "",
          strand: currentStrand,
          sub_strand: currentSubStrand,
          learning_outcomes: "",
          learning_experiences: "",
          source_document: ""
        });
      }
      const row = rowsByKey.get(key);
      if (captureMode === "outcomes") {
        row.learning_outcomes = appendNarrative(row.learning_outcomes, line);
      } else if (captureMode === "experiences") {
        row.learning_experiences = appendNarrative(row.learning_experiences, line);
      }
    }
  });

  return Array.from(rowsByKey.values())
    .map((row) => ({
      ...row,
      strand: cleanValue(row.strand),
      sub_strand: cleanValue(row.sub_strand),
      learning_outcomes: cleanValue(row.learning_outcomes),
      learning_experiences: cleanValue(row.learning_experiences)
    }))
    .filter((row) => row.strand && row.sub_strand);
}

async function extractKicdCurriculumFromCatalog(catalog, options = {}) {
  const maxDocuments = Math.min(Math.max(Number(options.max_documents || 200), 1), 1000);
  const maxPagesPerDocument = Math.min(Math.max(Number(options.max_pages_per_document || 200), 10), 1000);
  const documents = Array.isArray(catalog?.documents) ? catalog.documents.slice(0, maxDocuments) : [];
  const extractedRows = [];
  const documentSummaries = [];
  const documentErrors = [];

  for (const document of documents) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const session = await buildDriveViewerSession(document.source_file_id);
      // eslint-disable-next-line no-await-in-loop
      const meta = await fetchJson(session.meta_url, 30000);
      const totalPages = Math.max(Number(meta?.pages || 0), 0);
      const maxPages = Math.min(totalPages || maxPagesPerDocument, maxPagesPerDocument);
      const lines = [];
      let pagesScanned = 0;
      let pagesWithoutSignals = 0;
      for (let page = 1; page <= maxPages; page += 1) {
        const pressUrl = `${session.presspage_base_url}&page=${page}`;
        try {
          // eslint-disable-next-line no-await-in-loop
          const payload = await fetchJson(pressUrl, 30000);
          const pageLines = convertPressPayloadToLines(payload);
          const hasSignals = pageLines.some((line) => /strand|specific outcomes?|suggested learning experiences?/i.test(line));
          if (hasSignals) {
            pagesWithoutSignals = 0;
          } else {
            pagesWithoutSignals += 1;
          }
          lines.push(...pageLines);
          pagesScanned += 1;
          if (page > 30 && pagesWithoutSignals >= 25) {
            break;
          }
        } catch (_) {
          // Skip single-page OCR failures and continue with next page.
        }
      }

      const extracted = extractCurriculumRowsFromOcrLines(lines).map((row) => ({
        ...row,
        grade_label: cleanValue(document.grade_label),
        learning_area: cleanValue(document.learning_area),
        source_document: cleanValue(session.source_title || document.learning_area),
        source_preview_url: cleanValue(document.source_preview_url),
        source_file_id: cleanValue(document.source_file_id),
        level_key: cleanValue(document.level_key),
        level_label: cleanValue(document.level_label)
      }));
      extractedRows.push(...extracted);
      documentSummaries.push({
        source_file_id: document.source_file_id,
        source_title: session.source_title || document.learning_area,
        grade_label: document.grade_label,
        learning_area: document.learning_area,
        total_pages: totalPages,
        scanned_pages: pagesScanned,
        extracted_rows: extracted.length
      });
    } catch (error) {
      documentErrors.push({
        source_file_id: document.source_file_id,
        learning_area: document.learning_area,
        error: error.message
      });
    }
  }

  const mergedMap = new Map();
  extractedRows.forEach((row) => {
    const key = buildKey(row.grade_label, row.learning_area, row.strand, row.sub_strand);
    if (!mergedMap.has(key)) {
      mergedMap.set(key, { ...row });
      return;
    }
    const existing = mergedMap.get(key);
    existing.learning_outcomes = appendNarrative(existing.learning_outcomes, row.learning_outcomes);
    existing.learning_experiences = appendNarrative(existing.learning_experiences, row.learning_experiences);
  });

  return {
    scanned_document_count: documents.length,
    extracted_row_count: extractedRows.length,
    unique_row_count: mergedMap.size,
    rows: Array.from(mergedMap.values()),
    document_summaries: documentSummaries,
    document_errors: documentErrors
  };
}

module.exports = {
  KICD_LEVEL_PAGES,
  fetchKicdCatalog,
  extractKicdCurriculumFromCatalog
};
