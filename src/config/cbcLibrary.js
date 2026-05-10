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

const PRE_TECHNICAL_JSS_LIBRARY = {
  "Grade 7": {
    "1.0 Foundations of Pre-Technical Studies": [
      "1.1 Introduction to Pre-Technical Studies",
      "1.2 Safety in the Immediate environment",
      "1.3 Computer Concepts"
    ],
    "2.0 Communication in Pre-Technical studies": [
      "2.1 Introduction to Drawing",
      "2.2 Free-hand sketching",
      "2.3 ICT tools in Communication"
    ],
    "3.0 Materials for Production": [
      "3.1 Introduction to Materials",
      "3.2 Metallic Materials",
      "3.3 Non-Metallic Materials"
    ],
    "4.0 Tools and Production": [
      "4.1 Measuring and Marking Out Tools",
      "4.2 computer hardware"
    ],
    "5.0 Entrepreneurship": [
      "5.1 Introduction to Entrepreneurship",
      "5.2 Production Unit",
      "5.3 Financial Goals"
    ]
  },
  "Grade 8": {
    "1.0 Foundations of Pre-Technical studies": [
      "1.1 Fire Safety",
      "1.2 Data Safety"
    ],
    "2.0 Communication": [
      "2.1 Plane Geometry",
      "2.2 Dimensioning",
      "2.3 Plain scale drawing",
      "2.4 Visual programming"
    ],
    "3.0 Materials for production": [
      "3.1 Composite Materials",
      "3.2 Ceramics"
    ],
    "4.0 Tools and Production": [
      "4.1 Cutting Tools",
      "4.2 Computer Software"
    ],
    "5.0 Entrepreneurship": [
      "5.1 Bookkeeping",
      "5.2 Income and Budgeting",
      "5.3 Marketing goods and Services",
      "5.4 Distribution of Goods and Services"
    ]
  },
  "Grade 9": {
    "1.0 Foundations of Pre-Technical Studies": [
      "1.1 Safety on Raised Platforms",
      "1.2 Handling Hazardous Substances",
      "1.3 Self-Exploration and Career Development"
    ],
    "2.0 Communication in Pre-Technical Studies": [
      "2.1 Oblique Projection",
      "2.2 Visual Programming"
    ],
    "3.0 Materials for Production": [
      "3.1 Wood",
      "3.2 Handling Waste Materials"
    ],
    "4.0 Tools and Production": [
      "4.1 Holding Tools",
      "4.2 Driving Tools",
      "4.3 Project"
    ],
    "5.0 Entrepreneurship": [
      "5.1 Financial Services",
      "5.2 Government and Business",
      "5.3 Business Plan"
    ]
  }
};

const SOCIAL_STUDIES_JSS_LIBRARY = {
  "Grade 7": {
    "1.0 Personal Development": [
      "1.1 Self exploration",
      "1.2 Entrepreneurial opportunities in Social Studies"
    ],
    "2.0 People and Relationships": [
      "2.1 Human Origin",
      "2.2 Early Civilization",
      "2.3 Slavery and Servitude",
      "2.4 Development in Medium of Trade",
      "2.6 Peaceful Coexistence"
    ],
    "3.0 Community Service Learning": [
      "3.1 Community Service Learning"
    ],
    "4.0 Natural and Historic Built Environment": [
      "4.1 Historical Information",
      "4.2 Historical Development of Agriculture",
      "4.3 Maps and Map Work",
      "4.4 Earth and the Solar System",
      "4.5 Weather",
      "4.6 Fieldwork"
    ]
  },
  "Grade 8": {
    "1.0 People and Population": [
      "1.1 Scientific theory about human origin",
      "1.2 Early Civilization",
      "1.3 Population Group in Africa"
    ],
    "2.0 People and Relationships": [
      "2.1 Building Self-Esteem",
      "2.2 Emotional Care",
      "2.3 Resilience",
      "2.4 Socio-cultural Diversity and Inclusion",
      "2.5 Building Healthy Relationships",
      "2.6 Peaceful Conflict Resolution"
    ],
    "3.0 Community Service Learning": [
      "3.1 Community Service-learning project"
    ],
    "4.0 Natural and Historical Building Environments": [
      "4.1 Map Reading and Interpretation",
      "4.2 Weather and Climate",
      "4.3 Vegetation in Africa",
      "4.4 Historical Sites and Monuments in Africa"
    ],
    "5.0 Political Developments and Governance": [
      "5.1 The Constitution",
      "5.2 Human Rights",
      "5.3 Citizenship",
      "5.4 Essential skills in Critical Thinking",
      "5.5 Development of Creative Thinking",
      "5.6 Process of Problem-solving"
    ]
  },
  "Grade 9": {
    "1.0 Social Studies and Career Development": [
      "1.1 Pathway Choices",
      "1.2 Pre-Career Support System"
    ],
    "2.0 Community Service-Learning": [
      "2.1 Community Service-learning project"
    ],
    "3.0 People and Relationships": [
      "3.1 Social-economic practices of Early Humans",
      "3.2 Indigenous Knowledge Systems in African Societies",
      "3.3 Poverty Reduction",
      "3.4 Population Structure",
      "3.5 Peaceful Conflict Resolution",
      "3.6 Healthy Relationships"
    ],
    "4.0 Natural and Historical Built Environments": [
      "4.1 Topographical Maps",
      "4.2 Internal Land Forming Processes",
      "4.3 Multipurpose River Projects in Africa",
      "4.4 Management and Conservation of the Environment"
    ],
    "5.0 Political Developments and Governance": [
      "5.1 The Constitution of Kenya",
      "5.2 Civic Engagement in Governance",
      "5.3 Kenya's Bill of Rights",
      "5.4 Cultural Globalization"
    ]
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

function normalizeKey(value) {
  return normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isPreTechnicalLearningArea(value = "") {
  const key = normalizeKey(value);
  return key.includes("pretechnical") && key.includes("studies");
}

function isSocialStudiesLearningArea(value = "") {
  const key = normalizeKey(value);
  return key.includes("social") && key.includes("studies");
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
  const gradeKey = normalize(grade);
  if (isPreTechnicalLearningArea(subjectKey) && PRE_TECHNICAL_JSS_LIBRARY[gradeKey]) {
    const strands = Object.keys(PRE_TECHNICAL_JSS_LIBRARY[gradeKey]);
    const subStrandsByStrand = {};
    strands.forEach((strand) => {
      subStrandsByStrand[strand] = [...PRE_TECHNICAL_JSS_LIBRARY[gradeKey][strand]];
    });
    const selectedStrand = strands[0] || "";
    const selectedSubStrand = (subStrandsByStrand[selectedStrand] || [])[0] || "";
    return {
      strand: selectedStrand,
      sub_strand: selectedSubStrand,
      strand_options: strands,
      sub_strand_options_by_strand: subStrandsByStrand,
      learning_outcomes: "",
      assessment_rubric: "Add notes and assessment guidance for the selected sub-strand.",
      textbook_references: textbookReferences(subjectKey || "Pre-Technical Studies", gradeKey || "Junior Secondary"),
      generated_notes: ""
    };
  }
  if (isSocialStudiesLearningArea(subjectKey) && SOCIAL_STUDIES_JSS_LIBRARY[gradeKey]) {
    const strands = Object.keys(SOCIAL_STUDIES_JSS_LIBRARY[gradeKey]);
    const subStrandsByStrand = {};
    strands.forEach((strand) => {
      subStrandsByStrand[strand] = [...SOCIAL_STUDIES_JSS_LIBRARY[gradeKey][strand]];
    });
    const selectedStrand = strands[0] || "";
    const selectedSubStrand = (subStrandsByStrand[selectedStrand] || [])[0] || "";
    return {
      strand: selectedStrand,
      sub_strand: selectedSubStrand,
      strand_options: strands,
      sub_strand_options_by_strand: subStrandsByStrand,
      learning_outcomes: "",
      assessment_rubric: "Add notes and assessment guidance for the selected sub-strand.",
      textbook_references: textbookReferences(subjectKey || "Social Studies", gradeKey || "Junior Secondary"),
      generated_notes: ""
    };
  }
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

function getPreTechnicalSeedRows() {
  const rows = [];
  Object.entries(PRE_TECHNICAL_JSS_LIBRARY).forEach(([grade, strandsMap]) => {
    Object.entries(strandsMap).forEach(([strand, subStrands]) => {
      subStrands.forEach((subStrand) => {
        rows.push({
          grade,
          form_name: null,
          learning_area: "Pre-Technical Studies",
          strand,
          sub_strand: subStrand,
          specific_learning_outcomes: "",
          learning_experiences: "",
          notes: ""
        });
      });
    });
  });
  return rows;
}

function getSocialStudiesSeedRows() {
  const rows = [];
  Object.entries(SOCIAL_STUDIES_JSS_LIBRARY).forEach(([grade, strandsMap]) => {
    Object.entries(strandsMap).forEach(([strand, subStrands]) => {
      subStrands.forEach((subStrand) => {
        rows.push({
          grade,
          form_name: null,
          learning_area: "Social Studies",
          strand,
          sub_strand: subStrand,
          specific_learning_outcomes: "",
          learning_experiences: "",
          notes: ""
        });
      });
    });
  });
  return rows;
}

function getJuniorSecondaryCoreSeedRows() {
  return [...getPreTechnicalSeedRows(), ...getSocialStudiesSeedRows()];
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
  buildBulkCbcEntries,
  getPreTechnicalSeedRows,
  getSocialStudiesSeedRows,
  getJuniorSecondaryCoreSeedRows
};
