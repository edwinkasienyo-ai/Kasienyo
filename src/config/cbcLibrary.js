const { CBC_LEVELS } = require("./constants");

const DEFAULT_STRANDS = [
  "Foundational Literacy and Communication",
  "Inquiry and Problem Solving",
  "Practical Skills and Creativity"
];

function buildDefaultSubStrands(learningArea) {
  return [
    `Core Concepts in ${learningArea}`,
    `Application of ${learningArea} in Daily Life`,
    `${learningArea} Assessment and Reflection`
  ];
}

const SUBJECT_LIBRARY = {
  English: {
    strands: ["Listening and Speaking", "Reading", "Writing", "Language Use"],
    subStrandsByStrand: {
      "Listening and Speaking": ["Oral Narratives", "Pronunciation and Fluency", "Conversation Skills"],
      Reading: ["Guided Reading", "Comprehension Skills", "Vocabulary Development"],
      Writing: ["Creative Writing", "Functional Writing", "Grammar in Writing"],
      "Language Use": ["Parts of Speech", "Sentence Construction", "Editing and Proofreading"]
    }
  },
  Kiswahili: {
    strands: ["Kusikiliza na Kuzungumza", "Kusoma", "Kuandika", "Sarufi"],
    subStrandsByStrand: {
      "Kusikiliza na Kuzungumza": ["Matamshi", "Mazungumzo", "Hadithi za Mdomo"],
      Kusoma: ["Ufahamu", "Msamiati", "Kusoma kwa Ufasaha"],
      Kuandika: ["Insha", "Uandishi wa Kiutendaji", "Tahajia"],
      Sarufi: ["Aina za Maneno", "Uundaji wa Sentensi", "Matumizi Sahihi ya Lugha"]
    }
  },
  Mathematics: {
    strands: ["Numbers", "Measurement", "Geometry", "Data Handling"],
    subStrandsByStrand: {
      Numbers: ["Whole Numbers", "Operations", "Fractions and Decimals"],
      Measurement: ["Length and Mass", "Time", "Money"],
      Geometry: ["Shapes", "Angles", "Spatial Reasoning"],
      "Data Handling": ["Collection and Recording", "Representation", "Interpretation"]
    }
  }
};

function getAllCbcLearningAreas() {
  const levelAreas = Array.isArray(CBC_LEVELS)
    ? CBC_LEVELS.flatMap((level) => [
      ...(Array.isArray(level.learningAreas) ? level.learningAreas : []),
      ...Object.values(level.pathways || {}).flatMap((areas) => (Array.isArray(areas) ? areas : []))
    ])
    : [];
  return Array.from(new Set([...Object.keys(SUBJECT_LIBRARY), ...levelAreas]));
}

function normalize(value) {
  return String(value || "").trim();
}

function textbookReferences(learningArea, gradeOrForm) {
  const base = `${gradeOrForm} ${learningArea}`;
  return [
    `KICD Approved ${base} Learner's Book`,
    `KICD Approved ${base} Teacher's Guide`,
    `KLB ${base} Coursebook`,
    `Longhorn ${base} Integrated Resource`
  ];
}

function makeNotes({ grade, formName, learningArea, strand, subStrand }) {
  const level = normalize(grade) || normalize(formName) || "Class";
  return [
    `AI SIMPLIFIED NOTES - ${level}`,
    `Learning Area: ${learningArea}`,
    `Strand: ${strand}`,
    `Sub-Strand: ${subStrand}`,
    "",
    "Lesson Overview:",
    `This lesson introduces ${subStrand.toLowerCase()} under ${strand.toLowerCase()} in ${learningArea}.`,
    "",
    "Key Competencies:",
    "- Communication and collaboration",
    "- Critical thinking and problem solving",
    "- Learning to learn",
    "",
    "Teacher Guide:",
    "1) Warm-up activity (5 minutes)",
    "2) Guided content delivery (15 minutes)",
    "3) Learner practice task (15 minutes)",
    "4) Reflection and assessment (5 minutes)",
    "",
    "Assessment Rubric (Quick):",
    "- Exceeding expectation",
    "- Meeting expectation",
    "- Approaching expectation",
    "- Below expectation",
    "",
    "Homework:",
    `Learners complete one practical activity based on ${subStrand}.`
  ].join("\n");
}

function buildCbcSuggestion({ grade, formName, learningArea, mappingRows = [] }) {
  const mappedSuggestion = buildSuggestionFromMappings({
    grade,
    formName,
    learningArea,
    mappings: Array.isArray(mappingRows) ? mappingRows : []
  });
  if (mappedSuggestion) {
    return mappedSuggestion;
  }
  const subjectKey = normalize(learningArea);
  const library = SUBJECT_LIBRARY[subjectKey];
  const strands = library?.strands?.length ? library.strands : DEFAULT_STRANDS;
  const subStrandsByStrand = {};

  strands.forEach((strand) => {
    const configured = library?.subStrandsByStrand?.[strand];
    subStrandsByStrand[strand] = configured?.length ? configured : buildDefaultSubStrands(subjectKey || "the learning area");
  });

  const selectedStrand = strands[0];
  const selectedSubStrand = subStrandsByStrand[selectedStrand][0];
  const gradeOrForm = normalize(grade) || normalize(formName) || "General";

  return {
    strand: selectedStrand,
    sub_strand: selectedSubStrand,
    strand_options: strands,
    sub_strand_options_by_strand: subStrandsByStrand,
    learning_outcomes: `By the end of the lesson, learners should explain and apply ${selectedSubStrand} in ${subjectKey || "the learning area"}.`,
    assessment_rubric: "Assess participation, concept understanding, task completion, and reflection quality.",
    textbook_references: textbookReferences(subjectKey || "General Studies", gradeOrForm),
    generated_notes: makeNotes({
      grade,
      formName,
      learningArea: subjectKey || "General Studies",
      strand: selectedStrand,
      subStrand: selectedSubStrand
    })
  };
}

function buildSuggestionFromMappings({ grade, formName, learningArea, mappings = [] }) {
  const subjectKey = normalize(learningArea);
  const selectedGrade = normalize(grade);
  const selectedForm = normalize(formName);
  const filtered = mappings.filter((row) => {
    if (normalize(row.learning_area) !== subjectKey) return false;
    const rowGrade = normalize(row.grade);
    const rowForm = normalize(row.form_name);
    if (selectedGrade && rowGrade && rowGrade !== selectedGrade) return false;
    if (selectedForm && rowForm && rowForm !== selectedForm) return false;
    return true;
  });
  if (!filtered.length) return null;

  const strands = [];
  const subStrandsByStrand = {};
  filtered.forEach((row) => {
    const strand = normalize(row.strand);
    const subStrand = normalize(row.sub_strand);
    if (!strand || !subStrand) return;
    if (!strands.includes(strand)) {
      strands.push(strand);
    }
    if (!Array.isArray(subStrandsByStrand[strand])) {
      subStrandsByStrand[strand] = [];
    }
    if (!subStrandsByStrand[strand].includes(subStrand)) {
      subStrandsByStrand[strand].push(subStrand);
    }
  });
  if (!strands.length) return null;
  const selectedStrand = strands[0];
  const selectedSubStrand = (subStrandsByStrand[selectedStrand] || [])[0] || "";
  const gradeOrForm = selectedGrade || selectedForm || "General";

  return {
    strand: selectedStrand,
    sub_strand: selectedSubStrand,
    strand_options: strands,
    sub_strand_options_by_strand: subStrandsByStrand,
    learning_outcomes: `By the end of the lesson, learners should explain and apply ${selectedSubStrand} in ${subjectKey || "the learning area"}.`,
    assessment_rubric: "Assess participation, concept understanding, task completion, and reflection quality.",
    textbook_references: textbookReferences(subjectKey || "General Studies", gradeOrForm),
    generated_notes: makeNotes({
      grade: selectedGrade,
      formName: selectedForm,
      learningArea: subjectKey || "General Studies",
      strand: selectedStrand,
      subStrand: selectedSubStrand
    })
  };
}

function buildBulkCbcEntries({ grade, formName, term, year, learningAreas = [] }) {
  const selectedAreas = Array.isArray(learningAreas) && learningAreas.length
    ? learningAreas
    : getAllCbcLearningAreas();
  const rows = [];
  selectedAreas.forEach((learningArea) => {
    const suggestion = buildCbcSuggestion({ grade, formName, learningArea });
    const selectedGrade = normalize(grade) || null;
    const selectedForm = normalize(formName) || null;
    (suggestion.strand_options || []).forEach((strand) => {
      const subStrands = suggestion.sub_strand_options_by_strand?.[strand] || [];
      subStrands.forEach((subStrand) => {
        rows.push({
          grade: selectedGrade,
          form_name: selectedForm,
          learning_area: learningArea,
          strand,
          sub_strand: subStrand,
          specific_learning_outcomes: `Learners explain and apply ${subStrand} in ${learningArea}.`,
          suggested_assessment_rubric: suggestion.assessment_rubric,
          learning_experiences: "Discussion, guided examples, group practice, reflection.",
          resources_reference: suggestion.textbook_references.join("\n"),
          term: normalize(term) || null,
          year: Number(year) || null,
          notes: makeNotes({
            grade: selectedGrade || "",
            formName: selectedForm || "",
            learningArea,
            strand,
            subStrand
          })
        });
      });
    });
  });
  return rows;
}

module.exports = {
  buildCbcSuggestion,
  buildSuggestionFromMappings,
  makeNotes,
  getAllCbcLearningAreas,
  buildBulkCbcEntries
};
