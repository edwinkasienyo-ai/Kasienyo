const ROLES = {
  SUPER_SYSTEM_DEVELOPER: "SUPER_SYSTEM_DEVELOPER",
  SYSTEM_DEVELOPER: "SYSTEM_DEVELOPER",
  SYSTEM_ADMINISTRATOR: "SYSTEM_ADMINISTRATOR",
  ADMIN: "ADMIN",
  HEAD_OF_INSTITUTION: "HEAD_OF_INSTITUTION",
  MOD: "MOD",
  TSC: "TSC",
  TEACHER: "TEACHER",
  SENIOR_TEACHER: "SENIOR_TEACHER",
  HEAD_OF_DEPARTMENT: "HEAD_OF_DEPARTMENT",
  PARENT: "PARENT",
  NON_TEACHING_STAFF: "NON_TEACHING_STAFF",
  BOM: "BOM",
  LEARNER: "LEARNER",
  SUPPLIER: "SUPPLIER",
  CONTRACTOR: "CONTRACTOR"
};

const PERMISSIONS = {
  VIEW: "VIEW",
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  APPROVE: "APPROVE",
  CONTROL: "CONTROL",
  AMEND: "AMEND",
  ACCESS: "ACCESS"
};

const ROLE_PERMISSIONS = {
  [ROLES.SUPER_SYSTEM_DEVELOPER]: Object.values(PERMISSIONS),
  [ROLES.SYSTEM_DEVELOPER]: Object.values(PERMISSIONS),
  [ROLES.SYSTEM_ADMINISTRATOR]: Object.values(PERMISSIONS),
  [ROLES.ADMIN]: Object.values(PERMISSIONS),
  [ROLES.HEAD_OF_INSTITUTION]: Object.values(PERMISSIONS),
  [ROLES.MOD]: [PERMISSIONS.VIEW, PERMISSIONS.ACCESS],
  [ROLES.TSC]: [PERMISSIONS.VIEW, PERMISSIONS.ACCESS],
  [ROLES.TEACHER]: [
    PERMISSIONS.VIEW,
    PERMISSIONS.CREATE,
    PERMISSIONS.UPDATE,
    PERMISSIONS.ACCESS
  ],
  [ROLES.SENIOR_TEACHER]: [
    PERMISSIONS.VIEW,
    PERMISSIONS.CREATE,
    PERMISSIONS.UPDATE,
    PERMISSIONS.ACCESS
  ],
  [ROLES.HEAD_OF_DEPARTMENT]: [
    PERMISSIONS.VIEW,
    PERMISSIONS.CREATE,
    PERMISSIONS.UPDATE,
    PERMISSIONS.ACCESS
  ],
  [ROLES.PARENT]: [PERMISSIONS.VIEW, PERMISSIONS.ACCESS],
  [ROLES.NON_TEACHING_STAFF]: [PERMISSIONS.VIEW, PERMISSIONS.ACCESS],
  [ROLES.BOM]: [PERMISSIONS.VIEW, PERMISSIONS.ACCESS],
  [ROLES.LEARNER]: [PERMISSIONS.VIEW, PERMISSIONS.ACCESS],
  [ROLES.SUPPLIER]: [PERMISSIONS.VIEW, PERMISSIONS.ACCESS],
  [ROLES.CONTRACTOR]: [PERMISSIONS.VIEW, PERMISSIONS.ACCESS]
};

const GRADES = [
  "Play Group",
  "PP1",
  "PP2",
  "Grade 1",
  "Grade 2",
  "Grade 3",
  "Grade 4",
  "Grade 5",
  "Grade 6",
  "Grade 7",
  "Grade 8",
  "Grade 9",
  "Grade 10",
  "Grade 11",
  "Grade 12"
];

const FORMS = ["Form 3", "Form 4"];
const CBC_LEVELS = [
  {
    key: "pre-primary",
    label: "Pre-Primary",
    grades: ["Play Group", "PP1", "PP2"],
    learningAreas: [
      "Language Activities",
      "Mathematical Activities",
      "Creative Activities",
      "Environmental Activities",
      "Religious Activities",
      "Pastoral Instruction Programme"
    ]
  },
  {
    key: "lower-primary",
    label: "Lower Primary",
    grades: ["Grade 1", "Grade 2", "Grade 3"],
    learningAreas: [
      "Indigenous Language Activities",
      "Kiswahili Language Activities/Kenya Sign Language Activities",
      "English Language Activities",
      "Mathematical Activities",
      "Christian Religious Education Activities",
      "Environmental Activities",
      "Creative Activities",
      "Pastoral Instruction Programme"
    ]
  },
  {
    key: "upper-primary",
    label: "Upper Primary",
    grades: ["Grade 4", "Grade 5", "Grade 6"],
    learningAreas: [
      "English Number",
      "Kiswahili/Kenya Sign Language",
      "Mathematics",
      "Religious Education",
      "Science & Technology",
      "Agriculture",
      "Social Studies",
      "Creative Arts",
      "Pastoral/Religious Instruction Programme"
    ]
  },
  {
    key: "junior-secondary",
    label: "Junior Secondary",
    grades: ["Grade 7", "Grade 8", "Grade 9"],
    learningAreas: [
      "English",
      "Kiswahili/Kenya Sign Language",
      "Mathematics",
      "Religious Education (CRE, HRE, IRE)",
      "Social Studies",
      "Integrated Science",
      "Pre-Technical Studies",
      "Agriculture",
      "Creative Arts and Sports",
      "Pastoral/Religious Instructional Program",
      "Arabic",
      "French",
      "German",
      "Indigenous Language",
      "Mandarin"
    ]
  },
  {
    key: "senior-secondary",
    label: "Senior Secondary",
    grades: ["Grade 10", "Grade 11", "Grade 12", "Form 3", "Form 4"],
    pathways: {
      STEM: [
        "English",
        "Kiswahili/KSL",
        "Community Service Learning",
        "Physical Education",
        "Mathematics/Advanced Mathematics",
        "Biology",
        "Chemistry",
        "Physics",
        "General Science",
        "Agriculture",
        "Computer Studies",
        "Home Science",
        "Drawing and Design",
        "Aviation Technology",
        "Building and Construction",
        "Electrical Technology",
        "Metal Technology",
        "Power Mechanics",
        "Wood Technology",
        "Media Technology",
        "Marine and Fisheries Technology"
      ],
      "Social Sciences": [
        "English",
        "Kiswahili/KSL",
        "Community Service Learning",
        "Physical Education",
        "Advanced English",
        "Literature in English",
        "Indigenous Language",
        "Kiswahili Kipevu/Kenya Sign Language",
        "Fasihi ya Kiswahili",
        "Sign Language",
        "Arabic",
        "French",
        "German",
        "Mandarin Chinese",
        "History and Citizenship",
        "Geography",
        "Christian Religious Education/ Islamic Religious Education/Hindu Religious Education",
        "Business Studies"
      ],
      "Arts & Sports Science": [
        "English",
        "Kiswahili/KSL",
        "Community Service Learning",
        "Physical Education",
        "Sports and Recreation",
        "Physical Education (C)",
        "Music and Dance",
        "Theatre and Film",
        "Fine Arts"
      ]
    }
  }
];
const TERMS = ["Term One", "Term Two", "Term Three"];
const YEAR_JOINED_OPTIONS = Array.from({ length: 25 }, (_, index) => 1945 + index);
const GENDER_OPTIONS = ["Male", "Female", "Other"];
const ADMISSION_STATUS = [
  "In Session",
  "Not in Session",
  "Transferred",
  "Alumni",
  "Deceased"
];
const ORPHAN_STATUS = ["Both parents alive", "Partial orphan", "Total orphan", "Others"];

const YEAR_JOINED_WIDE_OPTIONS = Array.from({ length: 2145 - 1945 + 1 }, (_, index) => 1945 + index);

const WORLD_COUNTRY_NAMES = require("./worldCountryNames.json");
const WORLD_COUNTRY_OPTIONS = [...WORLD_COUNTRY_NAMES, "Others"];

const RELIGION_OPTIONS = [
  "Christianity",
  "Islam",
  "Hinduism",
  "Buddhism",
  "Judaism",
  "Baháʼí Faith",
  "Traditional / Indigenous",
  "No religious affiliation",
  "Others"
];

const DISABILITY_TYPE_OPTIONS = [
  "Visual impairment",
  "Hearing impairment",
  "Mobility / physical impairment",
  "Intellectual disability",
  "Autism spectrum",
  "ADHD",
  "Speech / language disorder",
  "Chronic illness",
  "Psychosocial / mental health",
  "Others"
];
const RELATIONSHIP_OPTIONS = ["Mother", "Father", "Guardian", "Sponsor", "Others"];
const STAFF_CATEGORY = ["Primary", "Junior Secondary", "Senior Secondary"];

const SUBJECTS = [
  "ALL",
  "English",
  "Kiswahili",
  "Kenya Sign Language (KSL)",
  "Mathematics",
  "Integrated Science",
  "Health Education",
  "Social Studies",
  "Religious Education (CRE/IRE/HRE)",
  "Pre-technical Studies",
  "Agriculture and Nutrition",
  "Creative Arts and Sports",
  "Life Skills Education",
  "Pure Sciences",
  "Applied Sciences",
  "Technical & Engineering",
  "Careers & Technology Studies",
  "Performing Arts",
  "Visual Arts",
  "Sports Science",
  "Languages & Literature",
  "Humanities & Business Studies",
  "Physical Education",
  "Community Service Learning (CSL)",
  "Agriculture",
  "Business Studies",
  "Biology",
  "Physics",
  "Chemistry",
  "History and Government",
  "Home Science",
  "Computer Studies",
  "Literature",
  "English/Literature"
];

const EXAM_TYPES = [
  "Head Start",
  "CATS",
  "Midterm Exam",
  "End Term Exam",
  "Joint Exam",
  "Mock",
  "Other"
];

const LEAVE_TYPES = [
  "Annual Leave",
  "Study Leave",
  "Compassionate Leave",
  "Maternity/Paternity",
  "Leave of Absence"
];

const TERMS_OF_SERVICE = ["Permanent", "Temporary", "Contract", "Casual", "Others"];

const DOCUMENT_CATEGORIES = {
  TEACHER_RESOURCE: [
    "Lesson Plan",
    "Schemes of Work",
    "Teacher Notes",
    "Record of Work Covered",
    "Learners Assessment/Progress Report",
    "Class Register",
    "Learners Discipline Records",
    "Professional Files",
    "Teacher Timetable"
  ],
  LAW_POLICY: ["Policies", "Laws", "Regulations", "Other Documents"],
  PROCUREMENT: ["LPO", "LSO", "Payment Voucher", "Award Letter"]
};

const EXPORT_FORMATS = [
  "PDF",
  "Excel",
  "Word",
  "PNG",
  "JPEG/JPG",
  "RAW",
  "HEIC/HEIF",
  "TIFF",
  "WEBP",
  "PowerPoint",
  "Other Microsoft Office Format"
];

module.exports = {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  GRADES,
  FORMS,
  CBC_LEVELS,
  TERMS,
  YEAR_JOINED_OPTIONS,
  YEAR_JOINED_WIDE_OPTIONS,
  WORLD_COUNTRY_OPTIONS,
  RELIGION_OPTIONS,
  DISABILITY_TYPE_OPTIONS,
  GENDER_OPTIONS,
  ADMISSION_STATUS,
  ORPHAN_STATUS,
  RELATIONSHIP_OPTIONS,
  STAFF_CATEGORY,
  SUBJECTS,
  EXAM_TYPES,
  LEAVE_TYPES,
  TERMS_OF_SERVICE,
  DOCUMENT_CATEGORIES,
  EXPORT_FORMATS
};
