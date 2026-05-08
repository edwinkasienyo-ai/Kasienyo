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
