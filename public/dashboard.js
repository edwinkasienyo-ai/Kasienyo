const token = localStorage.getItem("token");
if (!token) {
  window.location.href = "/";
}

let meta = {};
let currentModule = "dashboard";
let currentEditId = null;
let admissionSearchRows = [];
let currentValidationErrors = {};

const ADMISSION_SEARCH_FIELDS = [
  { value: "full_name", label: "Name" },
  { value: "admission_number", label: "Admission Number" },
  { value: "upi_number", label: "UPI Number" },
  { value: "assessment_number", label: "Assessment Number" },
  { value: "birth_certificate_number", label: "Birth Certificate Number" },
  { value: "status", label: "Status" },
  { value: "grade", label: "Grade" },
  { value: "form_name", label: "Form" }
];

const STATUS_COLORS = {
  "In Session": "#188038",
  "Not in Session": "#f6bf26",
  Transferred: "#1a73e8",
  Alumni: "#f57c00",
  Deceased: "#d93025"
};

const MODULE_REQUIRED_FIELDS = {
  admission: ["first_name", "last_name", "admission_number", "birth_certificate_number"],
  "management-teachers": ["full_name", "tsc_number", "id_number"],
  "management-non-teaching": ["full_name", "staff_number"],
  "management-teacher-resources": ["resource_type", "title"],
  attendance: ["attendance_type", "person_name", "attendance_date", "status"],
  "academic-exams": ["title"],
  "academic-marks": ["learner_id", "learner_name", "exam_type", "subject", "marks"],
  "hr-leave": ["staff_name", "leave_type"],
  "hr-recruitment": ["record_type"],
  "finance-fee-structure": ["grade", "term", "year", "amount_required"],
  "finance-fee-payments": ["learner_id", "learner_name", "amount_paid", "payment_date"],
  "finance-procurement": ["document_type", "supplier_name"],
  "communication-announcements": ["title", "message"],
  "communication-messages": ["message_type", "recipient_contact", "message_body"],
  "welfare-members": ["member_name", "member_role"],
  "welfare-contributions": ["member_id", "member_name", "contribution_period", "amount"],
  "welfare-loans": ["member_id", "member_name", "amount", "application_date"],
  laws: ["document_category", "title"]
};

const FIELD_HINTS = {
  admission_number: "Use a unique institution admission number (example: ADM-001).",
  birth_certificate_number: "Required unique identity for learner and parent login mappings.",
  parent_email: "If provided, use a valid email format like parent@example.com.",
  grade: "Choose Grade OR Form, not both.",
  form_name: "Choose Form OR Grade, not both.",
  marks: "Enter score between 0 and 100.",
  percentage: "Optional; if empty it auto-follows marks.",
  amount_paid: "Enter a positive amount.",
  amount_required: "Enter total fee required for the selected class/term/year.",
  payment_date: "Select payment date and time for accurate finance reports.",
  document_type: "Pick the procurement document type used by your institution.",
  attendance_date: "Choose the official attendance datetime.",
  status: "Choose the current official status from approved options."
};

const DEFAULT_MODULE_HELP = {
  summary: "Use this section to capture complete, accurate records before saving.",
  steps: [
    "Complete all required fields marked with *.",
    "Use Process for module automation or clean-up tasks where available.",
    "Use View to refresh records after Save or Process."
  ]
};

const MODULE_SECTION_HELP = {
  admission: {
    summary: "Capture learner biodata, parent contacts, status, and class placement accurately.",
    steps: [
      "Use Grade OR Form (not both).",
      "Bulk upload biodata using Excel/CSV template for many learners.",
      "Map photos by admission number filename or ZIP upload."
    ]
  },
  "management-teachers": {
    summary: "Maintain complete teacher profile and subject assignment records.",
    steps: [
      "Capture TSC and ID numbers exactly as official records.",
      "Assign major and other teaching subjects for scheduling.",
      "Add next-of-kin contact for emergency response."
    ]
  },
  "management-teacher-resources": {
    summary: "Manage lesson plans, schemes, and curriculum resources per class and term.",
    steps: [
      "Use Process to auto-generate a starter teaching resource.",
      "Set grade, term, strand, and sub-strand for traceability.",
      "Upload generated or approved files using system upload paths."
    ]
  },
  attendance: {
    summary: "Capture daily attendance with correct status and timing details.",
    steps: [
      "Use Process to auto-generate class register entries.",
      "Record attendance status using approved options only.",
      "Capture reason/comments for absences and late arrivals."
    ]
  },
  "academic-exams": {
    summary: "Prepare exam records per class, subject, and curriculum coverage.",
    steps: [
      "Use Process to auto-generate draft exam text.",
      "Capture strand/sub-strand for curriculum alignment.",
      "Set term and year for report filtering and retrieval."
    ]
  },
  "academic-marks": {
    summary: "Capture marks accurately for learner performance and positioning.",
    steps: [
      "Ensure learner ID matches the learner profile before saving.",
      "Enter marks between 0 and 100.",
      "Use Process to normalize percentages and CBC bands."
    ]
  },
  "finance-fee-structure": {
    summary: "Define required fees per class, term, and year.",
    steps: [
      "Capture grade, term, and year before amount.",
      "Enter a positive required fee amount.",
      "Use Process to generate fee summary and balances."
    ]
  },
  "finance-fee-payments": {
    summary: "Record learner fee payments and update balances reliably.",
    steps: [
      "Confirm learner ID and name before posting payment.",
      "Record payment method and payment datetime.",
      "Use Process to generate consolidated fee summary."
    ]
  },
  "communication-messages": {
    summary: "Send and track SMS/email notifications to institution stakeholders.",
    steps: [
      "Set recipient contact and message body clearly.",
      "Queue messages first where needed.",
      "Use Process to dispatch queued messages quickly."
    ]
  },
  laws: {
    summary: "Maintain institutional laws, regulations, and policy documents.",
    steps: [
      "Categorize each document correctly.",
      "Provide clear title and effective date.",
      "Update file path whenever policy files are replaced."
    ]
  }
};

const moduleConfigs = {
  admission: {
    title: "Admission Module - Learners Bio Data",
    endpoint: "/api/admission/learners",
    fields: [
      { name: "first_name", label: "First Name" },
      { name: "middle_name", label: "Middle Name" },
      { name: "last_name", label: "Last Name" },
      { name: "other_names", label: "Other Names" },
      { name: "full_name", label: "Full Name" },
      { name: "admission_number", label: "Admission Number" },
      { name: "date_of_admission", label: "Date of Admission", type: "date" },
      { name: "grade", label: "Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "form_name", label: "Form", type: "select", optionsKey: "formOptions" },
      { name: "stream", label: "Stream" },
      { name: "assessment_number", label: "Assessment Number" },
      { name: "upi_number", label: "UPI Number" },
      { name: "birth_certificate_number", label: "Birth Certificate Number" },
      { name: "date_of_birth", label: "Date of Birth", type: "date" },
      { name: "gender", label: "Gender", type: "select", optionsKey: "genderOptions" },
      { name: "passport_photo_path", label: "Passport Photo Path (/uploads/...)" },
      { name: "religion", label: "Religion" },
      { name: "nationality", label: "Nationality" },
      { name: "county", label: "County" },
      { name: "sub_county", label: "Sub County" },
      { name: "location", label: "Location" },
      { name: "sub_location", label: "Sub Location" },
      { name: "village", label: "Village" },
      { name: "year_joined", label: "Year Joined", type: "number" },
      { name: "term_joined", label: "Term Joined", type: "select", optionsKey: "termOptions" },
      { name: "orphan_condition", label: "Condition", type: "select", optionsKey: "orphanStatus" },
      { name: "status", label: "Status", type: "select", optionsKey: "admissionStatus" },
      { name: "parent_full_name", label: "Parent Name" },
      {
        name: "parent_relationship",
        label: "Parent Relationship",
        type: "select",
        optionsKey: "relationshipOptions"
      },
      { name: "parent_id_number", label: "Parent ID Number" },
      { name: "parent_phone", label: "Parent Phone Number" },
      { name: "parent_email", label: "Parent Email Address" }
    ]
  },
  "management-teachers": {
    title: "Teachers Profile",
    endpoint: "/api/management/teachers",
    fields: [
      { name: "full_name", label: "Full Name" },
      { name: "tsc_number", label: "TSC Number" },
      { name: "id_number", label: "ID Number" },
      { name: "phone_number", label: "Phone Number" },
      { name: "category", label: "Category", type: "select", optionsKey: "staffCategories" },
      { name: "major_subject", label: "Major Subject", type: "select", optionsKey: "subjectOptions" },
      { name: "other_subject", label: "Other Subject", type: "select", optionsKey: "subjectOptions" },
      { name: "next_of_kin_name", label: "Next of Kin Name" },
      { name: "next_of_kin_relationship", label: "Next of Kin Relationship" },
      { name: "next_of_kin_mobile", label: "Next of Kin Mobile" },
      { name: "next_of_kin_email", label: "Next of Kin Email" }
    ]
  },
  "management-non-teaching": {
    title: "Non-Teaching Staff Profile",
    endpoint: "/api/management/non-teaching-staff",
    fields: [
      { name: "full_name", label: "Full Name" },
      { name: "staff_number", label: "Staff Number (or auto generated)" },
      { name: "id_number", label: "ID Number" },
      { name: "phone_number", label: "Phone Number" },
      { name: "position_department", label: "Position/Department" },
      { name: "next_of_kin_name", label: "Next of Kin Name" },
      { name: "next_of_kin_contact", label: "Next of Kin Contact" }
    ]
  },
  "management-teacher-resources": {
    title: "Teacher Resource Module",
    endpoint: "/api/management/teacher-resources",
    fields: [
      { name: "teacher_profile_id", label: "Teacher Profile ID", type: "number" },
      { name: "resource_type", label: "Resource Type", type: "select", optionsKey: "teacherResourceTypes" },
      { name: "title", label: "Title" },
      { name: "description", label: "Description", type: "textarea" },
      { name: "grade", label: "Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "stream", label: "Stream" },
      { name: "term", label: "Term", type: "select", optionsKey: "termOptions" },
      { name: "strand", label: "Strand" },
      { name: "sub_strand", label: "Sub Strand" },
      { name: "file_path", label: "File Path (/uploads/...)" }
    ]
  },
  attendance: {
    title: "Attendance Management",
    endpoint: "/api/attendance/records",
    fields: [
      {
        name: "attendance_type",
        label: "Attendance Type",
        type: "select",
        options: ["Teacher", "Learner", "Non-Teaching"]
      },
      { name: "person_id", label: "Person ID" },
      { name: "person_name", label: "Person Name" },
      { name: "grade", label: "Class/Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "stream", label: "Stream" },
      { name: "attendance_date", label: "Attendance Date/Time", type: "datetime-local" },
      { name: "time_in", label: "Time In", type: "datetime-local" },
      { name: "time_out", label: "Time Out", type: "datetime-local" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          "Present",
          "Absent",
          "Late",
          "Official Duty",
          "Absent with Apology",
          "Absent with No Apology"
        ]
      },
      { name: "reason", label: "Reason for Absence" },
      { name: "comments", label: "Comment", type: "textarea" }
    ]
  },
  "academic-exams": {
    title: "Exam Management",
    endpoint: "/api/academic/exams",
    fields: [
      { name: "title", label: "Exam Title" },
      { name: "grade", label: "Class/Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "stream", label: "Stream" },
      { name: "subject", label: "Subject", type: "select", optionsKey: "subjectOptions" },
      { name: "strand", label: "Strand Covered" },
      { name: "sub_strand", label: "Sub-Strand Covered" },
      { name: "notes_file_path", label: "Notes File Path" },
      { name: "generated_exam_text", label: "Generated Exam Text", type: "textarea" },
      { name: "exam_file_path", label: "Exam File Path" },
      { name: "term", label: "Term", type: "select", optionsKey: "termOptions" },
      { name: "year", label: "Year", type: "number" }
    ]
  },
  "academic-marks": {
    title: "Marks Entry",
    endpoint: "/api/academic/marks",
    fields: [
      { name: "learner_id", label: "Learner ID", type: "number" },
      { name: "learner_name", label: "Learner Name" },
      { name: "upi_number", label: "UPI Number" },
      { name: "assessment_number", label: "Assessment Number" },
      { name: "birth_certificate_number", label: "Birth Certificate Number" },
      { name: "grade", label: "Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "stream", label: "Stream" },
      { name: "exam_type", label: "Exam Type", type: "select", optionsKey: "examTypes" },
      { name: "subject", label: "Subject", type: "select", optionsKey: "subjectOptions" },
      { name: "marks", label: "Marks", type: "number" },
      { name: "percentage", label: "Percentage", type: "number" },
      { name: "cbc_grade_band", label: "CBC Grade Band" },
      { name: "term", label: "Term", type: "select", optionsKey: "termOptions" },
      { name: "year", label: "Year", type: "number" }
    ]
  },
  "hr-leave": {
    title: "HR - Leave Management",
    endpoint: "/api/hr/leave-requests",
    fields: [
      {
        name: "staff_profile_type",
        label: "Staff Profile Type",
        type: "select",
        options: ["Teacher", "Non-Teaching Staff"]
      },
      { name: "staff_profile_id", label: "Staff Profile ID", type: "number" },
      { name: "staff_name", label: "Staff Name" },
      { name: "leave_type", label: "Leave Type", type: "select", optionsKey: "leaveTypes" },
      { name: "start_date", label: "Start Date", type: "date" },
      { name: "end_date", label: "End Date", type: "date" },
      { name: "reason", label: "Reason", type: "textarea" },
      { name: "status", label: "Status", type: "select", options: ["Pending", "Approved", "Rejected"] },
      {
        name: "approval_stage",
        label: "Approval Stage",
        type: "select",
        options: ["Member", "Loan Officer", "Principal", "Final"]
      }
    ]
  },
  "hr-recruitment": {
    title: "HR - Recruitment and Letters",
    endpoint: "/api/hr/recruitment-records",
    fields: [
      {
        name: "record_type",
        label: "Record Type",
        type: "select",
        options: [
          "Job Vacancy",
          "Shortlisting",
          "Appointment Letter",
          "Promotion Letter",
          "Suspension Letter",
          "Warning Letter",
          "Show Cause Letter",
          "Dismissal Letter",
          "Early Retirement"
        ]
      },
      { name: "position_name", label: "Job/Position" },
      { name: "candidate_name", label: "Name" },
      { name: "candidate_id_number", label: "ID Number" },
      { name: "candidate_mobile", label: "Mobile" },
      { name: "terms_of_service", label: "Terms of Service", type: "select", optionsKey: "termsOfService" },
      { name: "job_description", label: "Job Description", type: "textarea" },
      { name: "comments", label: "Comments", type: "textarea" },
      { name: "upload_file_path", label: "File Path" },
      { name: "deadline_date", label: "Deadline", type: "date" },
      { name: "status", label: "Status", type: "select", options: ["Pending", "Approved", "Rejected", "Issued"] }
    ]
  },
  "finance-fee-structure": {
    title: "Finance - Fee Structure",
    endpoint: "/api/finance/fee-structures",
    fields: [
      { name: "grade", label: "Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "stream", label: "Stream" },
      { name: "term", label: "Term", type: "select", optionsKey: "termOptions" },
      { name: "year", label: "Year", type: "number" },
      { name: "amount_required", label: "Amount Required", type: "number" },
      { name: "description", label: "Description", type: "textarea" }
    ]
  },
  "finance-fee-payments": {
    title: "Finance - Fee Payments",
    endpoint: "/api/finance/fee-payments",
    fields: [
      { name: "learner_id", label: "Learner ID", type: "number" },
      { name: "learner_name", label: "Learner Name" },
      { name: "admission_number", label: "Admission Number" },
      { name: "grade", label: "Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "stream", label: "Stream" },
      { name: "amount_paid", label: "Amount Paid", type: "number" },
      {
        name: "payment_method",
        label: "Payment Method",
        type: "select",
        options: ["Cash", "Bank", "Mpesa", "Cheque", "Other"]
      },
      { name: "receipt_number", label: "Receipt Number" },
      { name: "payment_date", label: "Payment Date", type: "datetime-local" },
      { name: "balance_after_payment", label: "Balance After Payment", type: "number" }
    ]
  },
  "finance-procurement": {
    title: "Finance - Procurement (LPO/LSO/Vouchers/Award)",
    endpoint: "/api/finance/procurement",
    fields: [
      { name: "document_type", label: "Document Type", type: "select", optionsKey: "procurementDocumentTypes" },
      { name: "document_number", label: "Document Number (auto/reference)" },
      { name: "supplier_name", label: "Supplier Name" },
      { name: "item_name", label: "Item/Service Name" },
      { name: "description", label: "Description", type: "textarea" },
      { name: "quantity", label: "Quantity", type: "number" },
      { name: "amount", label: "Amount", type: "number" },
      { name: "document_date", label: "Document Date", type: "date" },
      { name: "due_date", label: "Due Date", type: "date" },
      { name: "status", label: "Status", type: "select", options: ["Draft", "Approved", "Issued", "Closed"] },
      { name: "file_path", label: "File Path" },
      { name: "qr_code_text", label: "QR Code Value/Text" }
    ]
  },
  "communication-announcements": {
    title: "Communication - Announcements",
    endpoint: "/api/communication/announcements",
    fields: [
      { name: "title", label: "Title" },
      { name: "message", label: "Announcement Message", type: "textarea" },
      {
        name: "audience",
        label: "Audience",
        type: "select",
        options: ["All", "Teachers", "Parents", "Learners", "Non-Teaching", "BOM"]
      },
      { name: "start_date", label: "Start Date", type: "date" },
      { name: "end_date", label: "End Date", type: "date" }
    ]
  },
  "communication-messages": {
    title: "Communication - SMS and Notifications",
    endpoint: "/api/communication/messages",
    fields: [
      {
        name: "message_type",
        label: "Message Type",
        type: "select",
        options: ["SMS", "Email", "Push", "Parent Result Notice", "Fee Reminder"]
      },
      {
        name: "recipient_role",
        label: "Recipient Role",
        type: "select",
        options: ["Parent", "Teacher", "Head", "Admin", "BOM", "Learner", "Non-Teaching"]
      },
      { name: "recipient_contact", label: "Recipient Contact (Phone/Email)" },
      { name: "message_body", label: "Message Body", type: "textarea" },
      { name: "status", label: "Status", type: "select", options: ["Queued", "Sent", "Failed"] },
      { name: "sent_at", label: "Sent At", type: "datetime-local" }
    ]
  },
  "welfare-members": {
    title: "Staff Welfare - Members",
    endpoint: "/api/welfare/members",
    fields: [
      { name: "member_name", label: "Member Name" },
      { name: "member_role", label: "Member Role", type: "select", options: ["Teacher", "Non-Teaching Staff", "Head", "Other"] },
      { name: "phone_number", label: "Phone Number" },
      { name: "email", label: "Email" },
      { name: "joined_date", label: "Joined Date", type: "date" },
      { name: "status", label: "Status", type: "select", options: ["Active", "Inactive"] }
    ]
  },
  "welfare-contributions": {
    title: "Staff Welfare - Contributions",
    endpoint: "/api/welfare/contributions",
    fields: [
      { name: "member_id", label: "Member ID", type: "number" },
      { name: "member_name", label: "Member Name" },
      { name: "contribution_period", label: "Contribution Period (Month/Term)" },
      { name: "amount", label: "Amount", type: "number" },
      {
        name: "payment_mode",
        label: "Payment Mode",
        type: "select",
        options: ["Cash", "Bank", "Mpesa", "Payroll Deduction", "Other"]
      },
      { name: "payment_date", label: "Payment Date", type: "date" }
    ]
  },
  "welfare-loans": {
    title: "Staff Welfare - Loans Workflow",
    endpoint: "/api/welfare/loans",
    fields: [
      { name: "member_id", label: "Member ID", type: "number" },
      { name: "member_name", label: "Member Name" },
      { name: "amount", label: "Loan Amount", type: "number" },
      { name: "application_date", label: "Application Date", type: "date" },
      { name: "return_date", label: "Return Date", type: "date" },
      {
        name: "status",
        label: "Overall Status",
        type: "select",
        options: ["Pending", "Approved", "Rejected", "Disbursed", "Closed"]
      },
      {
        name: "loan_officer_approval",
        label: "Loan Officer Approval",
        type: "select",
        options: ["Pending", "Approved", "Rejected"]
      },
      {
        name: "principal_approval",
        label: "Principal Approval",
        type: "select",
        options: ["Pending", "Approved", "Rejected"]
      },
      {
        name: "repayment_status",
        label: "Repayment Tracking",
        type: "select",
        options: ["Not Started", "In Progress", "Completed", "Defaulted"]
      }
    ]
  },
  laws: {
    title: "Laws, Regulations and Policies",
    endpoint: "/api/laws/documents",
    fields: [
      { name: "document_category", label: "Category", type: "select", optionsKey: "legalDocumentCategories" },
      { name: "title", label: "Title" },
      { name: "description", label: "Description", type: "textarea" },
      { name: "file_path", label: "File Path" },
      { name: "effective_date", label: "Effective Date", type: "date" }
    ]
  }
};

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (response.status === 401 || response.status === 403) {
    localStorage.clear();
    window.location.href = "/";
    return null;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function buildInput(field) {
  const id = `field-${field.name}`;
  const required = field.required ? '<span class="required-star">*</span>' : "";
  const hint = field.hint ? `<p class="field-hint">${escapeHtml(field.hint)}</p>` : "";
  const helpIcon = field.hint
    ? `<span class="help-icon" title="${escapeHtml(field.hint)}" aria-label="${escapeHtml(
        field.hint
      )}">i</span>`
    : "";
  const error = `<p id="error-${field.name}" class="field-error" aria-live="polite"></p>`;
  if (field.type === "textarea") {
    return `
      <div class="field-block">
        <label for="${id}">${field.label} ${required} ${helpIcon}</label>
        <textarea id="${id}" rows="3" placeholder="${field.label}"></textarea>
        ${hint}
        ${error}
      </div>
    `;
  }
  if (field.type === "select") {
    const options = field.options || meta[field.optionsKey] || [];
    const optionHtml = ['<option value="">Select...</option>']
      .concat(options.map((option) => `<option value="${option}">${option}</option>`))
      .join("");
    return `
      <div class="field-block">
        <label for="${id}">${field.label} ${required} ${helpIcon}</label>
        <select id="${id}">${optionHtml}</select>
        ${hint}
        ${error}
      </div>
    `;
  }
  return `
    <div class="field-block">
      <label for="${id}">${field.label} ${required} ${helpIcon}</label>
      <input id="${id}" type="${field.type || "text"}" placeholder="${field.label}" />
      ${hint}
      ${error}
    </div>
  `;
}

function statusColor(status) {
  return STATUS_COLORS[status] || "#5f7187";
}

function attachFieldMetadata(moduleKey, config) {
  const requiredNames = new Set(MODULE_REQUIRED_FIELDS[moduleKey] || []);
  config.fields.forEach((field) => {
    field.required = requiredNames.has(field.name);
    field.hint = field.hint || FIELD_HINTS[field.name] || "";
  });
}

function moduleHelpContent(moduleKey) {
  return MODULE_SECTION_HELP[moduleKey] || DEFAULT_MODULE_HELP;
}

function renderModuleHelp(moduleKey) {
  const help = moduleHelpContent(moduleKey);
  const stepsHtml = (help.steps || [])
    .map((step) => `<li>${escapeHtml(step)}</li>`)
    .join("");
  return `
    <div class="module-help-card" id="moduleHelpCard">
      <div class="module-help-header">
        <h4>
          Section Help
          <span class="help-icon" title="Guidance for this module." aria-label="Guidance for this module.">i</span>
        </h4>
        <button id="toggleModuleHelpButton" class="module-help-toggle">Hide Help</button>
      </div>
      <div id="moduleHelpBody" class="module-help-body">
        <p class="module-help-summary">${escapeHtml(help.summary || "")}</p>
        <ol class="module-help-steps">${stepsHtml}</ol>
      </div>
    </div>
  `;
}

function bindModuleHelpToggle() {
  const button = document.getElementById("toggleModuleHelpButton");
  const body = document.getElementById("moduleHelpBody");
  if (!button || !body) return;
  button.onclick = () => {
    const hidden = body.classList.toggle("is-hidden");
    button.textContent = hidden ? "Show Help" : "Hide Help";
  };
}

function statusBadgeHtml(status) {
  return `<span class="status-badge" style="background:${statusColor(status)}">${status || "N/A"}</span>`;
}

function createAuthDownloadUrl(endpoint) {
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}token=${encodeURIComponent(token)}`;
}

function openProtectedUrl(endpoint) {
  window.open(createAuthDownloadUrl(endpoint), "_blank");
}

function renderAdmissionStatusSummary(summary = null) {
  const target = document.getElementById("admissionStatusSummary");
  if (!target) return;
  if (!summary || !Array.isArray(summary.byStatus)) {
    target.innerHTML = '<p class="small-note">Status summary unavailable.</p>';
    return;
  }

  const statusItems = summary.byStatus
    .filter((item) => Number(item.count || 0) > 0)
    .map(
      (item) => `
        <span class="tag summary-tag" style="border-color:${item.color};">
          <span class="summary-dot" style="background:${item.color};"></span>
          ${escapeHtml(item.status)}: ${Number(item.count || 0)}
        </span>
      `
    )
    .join("");

  target.innerHTML = `
    <div class="summary-header">
      <strong>Total Learners: ${Number(summary.totalLearners || 0)}</strong>
      <span class="small-note">${summary.statusFilter ? `Filter: ${escapeHtml(summary.statusFilter)}` : "All statuses"}</span>
    </div>
    <div class="summary-tags">${statusItems || '<span class="small-note">No learners found.</span>'}</div>
  `;
}

function admissionToolsHtml() {
  return `
    <div class="admission-tools">
      <h4>Admission Bulk Upload and Search Tools</h4>
      <p class="small-note">Download template, fill learner biodata, upload Excel/CSV, then add photos while editing each learner, batch filenames (AdmissionNumber.jpg), or ZIP upload.</p>
      <div class="admission-tools-grid">
        <div>
          <label>Template + Biodata Upload</label>
          <div class="actions-row">
            <button id="downloadAdmissionTemplateButton">Download Excel Template</button>
            <button id="downloadAdmissionCsvTemplateButton">Download CSV Template</button>
            <input id="admissionExcelInput" type="file" accept=".xlsx,.csv" />
            <button id="uploadAdmissionExcelButton">Upload Filled Excel/CSV</button>
            <button id="downloadAdmissionRejectionReportButton">Download Rejection Report</button>
          </div>
        </div>
        <div>
          <label>Batch photo upload by filename</label>
          <div class="actions-row">
            <input id="admissionPhotoBatchInput" type="file" accept="image/*" multiple />
            <button id="uploadAdmissionPhotoBatchButton">Upload Photo Batch</button>
          </div>
          <p class="small-note">Name each photo with admission number, e.g. ADM001.jpg</p>
        </div>
        <div>
          <label>Batch photo ZIP upload</label>
          <div class="actions-row">
            <input id="admissionPhotoZipInput" type="file" accept=".zip" />
            <button id="uploadAdmissionPhotoZipButton">Upload Photo ZIP</button>
          </div>
          <p class="small-note">ZIP must contain image files named by admission number.</p>
        </div>
        <div>
          <label>Search learner record</label>
          <div class="search-row">
            <select id="admissionSearchField">
              ${ADMISSION_SEARCH_FIELDS.map((item) => `<option value="${item.value}">${item.label}</option>`).join("")}
            </select>
            <input id="admissionSearchValue" placeholder="Search value" />
            <select id="admissionSearchStatus">
              <option value="">Any status</option>
              ${(meta.admissionStatus || []).map((status) => `<option value="${status}">${status}</option>`).join("")}
            </select>
            <button id="admissionSearchButton">Search</button>
          </div>
        </div>
      </div>
      <div class="actions-row">
        <button id="admissionRecordPrintButton">Print Records</button>
        <button id="admissionGroupedRegisterButton">Print Grouped Register</button>
        <button id="refreshAdmissionSummaryButton">Refresh Status Summary</button>
      </div>
      <div id="admissionStatusSummary" class="admission-status-summary"></div>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindAdmissionMutualExclusion() {
  const gradeEl = document.getElementById("field-grade");
  const formEl = document.getElementById("field-form_name");
  if (!gradeEl || !formEl) return;

  const sync = () => {
    const gradeHasValue = String(gradeEl.value || "").trim() !== "";
    const formHasValue = String(formEl.value || "").trim() !== "";

    if (gradeHasValue) {
      formEl.value = "";
      formEl.disabled = true;
    } else {
      formEl.disabled = false;
    }

    if (formHasValue) {
      gradeEl.value = "";
      gradeEl.disabled = true;
    } else {
      gradeEl.disabled = false;
    }
  };

  gradeEl.addEventListener("change", sync);
  formEl.addEventListener("change", sync);
  sync();
}

function getFieldValue(field) {
  const el = document.getElementById(`field-${field.name}`);
  if (!el) return null;
  if (field.type === "number") {
    return el.value === "" ? null : Number(el.value);
  }
  return el.value || null;
}

function clearFieldErrors(config) {
  currentValidationErrors = {};
  config.fields.forEach((field) => {
    const errorEl = document.getElementById(`error-${field.name}`);
    const inputEl = document.getElementById(`field-${field.name}`);
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.style.display = "none";
    }
    if (inputEl) {
      inputEl.classList.remove("input-invalid");
    }
  });
}

function showFieldErrors(config, errors = {}) {
  currentValidationErrors = { ...errors };
  config.fields.forEach((field) => {
    const message = errors[field.name] || "";
    const errorEl = document.getElementById(`error-${field.name}`);
    const inputEl = document.getElementById(`field-${field.name}`);
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = message ? "block" : "none";
    }
    if (inputEl) {
      if (message) inputEl.classList.add("input-invalid");
      else inputEl.classList.remove("input-invalid");
    }
  });
}

function parseServerErrorToFieldErrors(errorMessage, config) {
  const message = String(errorMessage || "").toLowerCase();
  const fieldErrors = {};
  config.fields.forEach((field) => {
    const token = field.name.replaceAll("_", " ");
    if (message.includes(token) || message.includes(field.label.toLowerCase())) {
      fieldErrors[field.name] = String(errorMessage);
    }
  });
  return fieldErrors;
}

function validateFormLocally(config, payload) {
  const errors = {};
  config.fields.forEach((field) => {
    if (!field.required) return;
    const value = payload[field.name];
    if (value === null || value === undefined || String(value).trim() === "") {
      errors[field.name] = `${field.label} is required.`;
    }
  });

  if (currentModule === "admission") {
    if (!payload.grade && !payload.form_name) {
      errors.grade = "Select Grade or Form.";
      errors.form_name = "Select Form or Grade.";
    }
  }
  return errors;
}

function ensureFormNotice() {
  const formArea = document.getElementById("formArea");
  if (!formArea) return null;
  const existing = document.getElementById("formNotice");
  if (existing) return existing;
  formArea.insertAdjacentHTML("afterbegin", '<div id="formNotice" class="form-notice" aria-live="polite"></div>');
  return document.getElementById("formNotice");
}

function setFormNotice(message, type = "info") {
  const notice = ensureFormNotice();
  if (!notice) return;
  notice.className = `form-notice ${type}`;
  notice.textContent = message || "";
  notice.style.display = message ? "block" : "none";
}

function clearFormNotice() {
  setFormNotice("", "info");
}

function setFieldValue(field, value) {
  const el = document.getElementById(`field-${field.name}`);
  if (!el) return;
  el.value = value ?? "";
}

function clearForm(config) {
  currentEditId = null;
  config.fields.forEach((field) => setFieldValue(field, ""));
}

function cbcBandFromScore(score) {
  const mark = Number(score);
  if (mark >= 75) return "EE";
  if (mark >= 50) return "ME";
  if (mark >= 25) return "AE";
  return "BE";
}

function jsonPreview(data) {
  return `<pre class="process-output">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
}

function setProcessResult(title, payload) {
  const formArea = document.getElementById("formArea");
  if (!formArea) return;
  const existing = document.getElementById("moduleProcessResult");
  const content = `
    <div id="moduleProcessResult" class="module-process-result">
      <h4>${escapeHtml(title)}</h4>
      ${jsonPreview(payload)}
    </div>
  `;
  if (existing) {
    existing.outerHTML = content;
  } else {
    formArea.insertAdjacentHTML("beforeend", content);
  }
}

function processEndpointForModule(moduleKey) {
  switch (moduleKey) {
    case "admission":
      return {
        endpoint: "/api/workflows/admission-integrity-audit",
        buildPayload: () => ({}),
        title: "Admission Integrity Audit"
      };
    case "attendance":
      return {
        endpoint: "/api/attendance/auto-class-register",
        buildPayload: () => ({
          grade: document.getElementById("field-grade")?.value || null,
          stream: document.getElementById("field-stream")?.value || null,
          attendance_date: document.getElementById("field-attendance_date")?.value || null
        }),
        title: "Auto Class Register"
      };
    case "management-teacher-resources":
      return {
        endpoint: "/api/management/teacher-resources/auto-generate",
        buildPayload: () => ({
          teacher_profile_id: document.getElementById("field-teacher_profile_id")?.value || null,
          resource_type: document.getElementById("field-resource_type")?.value || null,
          grade: document.getElementById("field-grade")?.value || null,
          term: document.getElementById("field-term")?.value || null,
          strand: document.getElementById("field-strand")?.value || null,
          sub_strand: document.getElementById("field-sub_strand")?.value || null
        }),
        title: "Teacher Resource Auto Generation"
      };
    case "academic-exams":
      return {
        endpoint: "/api/academic/exams/auto-generate",
        buildPayload: () => ({
          title: document.getElementById("field-title")?.value || null,
          grade: document.getElementById("field-grade")?.value || null,
          stream: document.getElementById("field-stream")?.value || null,
          subject: document.getElementById("field-subject")?.value || null,
          strand: document.getElementById("field-strand")?.value || null,
          sub_strand: document.getElementById("field-sub_strand")?.value || null,
          term: document.getElementById("field-term")?.value || null,
          year: document.getElementById("field-year")?.value || null,
          notes_file_path: document.getElementById("field-notes_file_path")?.value || null
        }),
        title: "Academic Exam Auto Generation"
      };
    case "academic-marks":
      return {
        endpoint: "/api/workflows/academic/normalize-gradebook",
        buildPayload: () => ({
          grade: document.getElementById("field-grade")?.value || null,
          term: document.getElementById("field-term")?.value || null,
          year: document.getElementById("field-year")?.value || null
        }),
        title: "Academic Gradebook Normalization"
      };
    case "communication-messages":
      return {
        endpoint: "/api/workflows/communication/dispatch-queued",
        buildPayload: () => ({ limit: 200 }),
        title: "Queued Communication Dispatch"
      };
    case "finance-fee-structure":
    case "finance-fee-payments":
      return {
        endpoint: "/api/workflows/finance/fee-summary",
        buildPayload: () => ({
          grade: document.getElementById("field-grade")?.value || null,
          term: document.getElementById("field-term")?.value || null,
          year: document.getElementById("field-year")?.value || null
        }),
        title: "Finance Fee Summary"
      };
    default:
      return null;
  }
}

async function processCurrentModule() {
  const action = processEndpointForModule(currentModule);
  if (!action) {
    alert("No process workflow configured for this module yet.");
    return;
  }
  try {
    const result = await request(action.endpoint, {
      method: "POST",
      body: JSON.stringify(action.buildPayload())
    });
    setProcessResult(action.title, result);
    if (moduleConfigs[currentModule]) {
      await loadModuleData(moduleConfigs[currentModule]);
    }
  } catch (error) {
    alert(error.message);
  }
}

async function saveCurrentModule() {
  const config = moduleConfigs[currentModule];
  if (!config) return;

  clearFieldErrors(config);
  clearFormNotice();
  const payload = {};
  config.fields.forEach((field) => {
    payload[field.name] = getFieldValue(field);
  });

  const localErrors = validateFormLocally(config, payload);
  if (Object.keys(localErrors).length) {
    showFieldErrors(config, localErrors);
    setFormNotice("Fix highlighted fields before saving.", "error");
    return;
  }

  if (currentModule === "academic-marks" && payload.marks !== null) {
    payload.percentage = payload.percentage ?? payload.marks;
    payload.cbc_grade_band = payload.cbc_grade_band || cbcBandFromScore(payload.marks);
  }

  try {
    if (currentEditId) {
      await request(`${config.endpoint}/${currentEditId}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      setFormNotice("Record updated successfully.", "success");
    } else {
      await request(config.endpoint, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setFormNotice("Record saved successfully.", "success");
    }
    clearFieldErrors(config);
    clearForm(config);
    await loadModuleData(config);
  } catch (error) {
    const fieldErrors = parseServerErrorToFieldErrors(error.message, config);
    if (Object.keys(fieldErrors).length) {
      showFieldErrors(config, fieldErrors);
      setFormNotice("Some fields need correction. See highlighted errors.", "error");
      return;
    }
    setFormNotice(error.message, "error");
  }
}

async function editRow(id) {
  const config = moduleConfigs[currentModule];
  if (!config) return;
  try {
    const row = await request(`${config.endpoint}/${id}`);
    currentEditId = row.id;
    config.fields.forEach((field) => setFieldValue(field, row[field.name]));
    if (currentModule === "admission") {
      bindAdmissionMutualExclusion();
    }
  } catch (error) {
    alert(error.message);
  }
}

async function deleteRow(id) {
  const config = moduleConfigs[currentModule];
  if (!config) return;
  const ok = window.confirm("Delete this record permanently?");
  if (!ok) return;
  try {
    await request(`${config.endpoint}/${id}`, { method: "DELETE" });
    await loadModuleData(config);
  } catch (error) {
    alert(error.message);
  }
}

async function exportPdf() {
  const config = moduleConfigs[currentModule];
  if (!config) return;
  openProtectedUrl(`${config.endpoint}/export/pdf`);
}

async function exportExcel() {
  const config = moduleConfigs[currentModule];
  if (!config) return;
  openProtectedUrl(`${config.endpoint}/export/excel`);
}

async function downloadAdmissionTemplate() {
  openProtectedUrl("/api/admission/learners/template/excel");
}

async function downloadAdmissionCsvTemplate() {
  openProtectedUrl("/api/admission/learners/template/csv");
}

async function uploadAdmissionExcel() {
  const fileInput = document.getElementById("admissionExcelInput");
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    alert("Select a completed .xlsx or .csv template first.");
    return;
  }
  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  try {
    const response = await fetch("/api/admission/learners/bulk-upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Bulk upload failed.");
    }
    const rejected = data.rejectedRows?.length || 0;
    alert(
      `Bulk upload completed. Format: ${data.sourceFormat || "unknown"}. Processed: ${data.insertedOrUpdated || 0}. Rejected: ${rejected}.`
    );
    if (data.rejectionReportPath) {
      localStorage.setItem("admissionRejectionReportPath", data.rejectionReportPath);
    } else {
      localStorage.removeItem("admissionRejectionReportPath");
    }
    fileInput.value = "";
    await loadModuleData(moduleConfigs.admission);
  } catch (error) {
    alert(error.message);
  }
}

function downloadAdmissionRejectionReport() {
  const reportPath = localStorage.getItem("admissionRejectionReportPath");
  if (!reportPath) {
    alert("No rejection report available yet. Upload biodata first.");
    return;
  }
  openProtectedUrl(reportPath);
}

async function uploadAdmissionPhotoBatch() {
  const fileInput = document.getElementById("admissionPhotoBatchInput");
  if (!fileInput || !fileInput.files || !fileInput.files.length) {
    alert("Select learner photos first. Filenames must be admission numbers.");
    return;
  }

  const formData = new FormData();
  Array.from(fileInput.files).forEach((file) => {
    formData.append("photos", file);
  });

  try {
    const response = await fetch("/api/admission/learners/photo-batch-upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Batch photo upload failed.");
    }
    const rejected = data.rejectedFiles?.length || 0;
    alert(
      `Photo batch processed. Uploaded: ${data.uploaded || 0}, Matched: ${data.matchedCount || 0}, Rejected: ${rejected}.`
    );
    fileInput.value = "";
    await loadModuleData(moduleConfigs.admission);
  } catch (error) {
    alert(error.message);
  }
}

async function uploadAdmissionPhotoZipBatch() {
  const fileInput = document.getElementById("admissionPhotoZipInput");
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    alert("Select ZIP file first.");
    return;
  }
  const formData = new FormData();
  formData.append("zipFile", fileInput.files[0]);
  try {
    const response = await fetch("/api/admission/learners/photo-batch-zip-upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "ZIP photo upload failed.");
    }
    const rejected = data.rejectedFiles?.length || 0;
    alert(
      `ZIP photo batch processed. Extracted: ${data.extracted || 0}, Matched: ${data.matchedCount || 0}, Rejected: ${rejected}.`
    );
    fileInput.value = "";
    await loadModuleData(moduleConfigs.admission);
  } catch (error) {
    alert(error.message);
  }
}

async function searchAdmission() {
  const field = document.getElementById("admissionSearchField")?.value || "full_name";
  const value = document.getElementById("admissionSearchValue")?.value?.trim() || "";
  const status = document.getElementById("admissionSearchStatus")?.value || "";
  try {
    const query = new URLSearchParams({ field, value, status });
    const rows = await request(`/api/admission/learners/search?${query.toString()}`);
    admissionSearchRows = rows || [];
    renderAdmissionTable(admissionSearchRows);
  } catch (error) {
    alert(error.message);
  }
}

async function uploadLearnerPhoto(learnerId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    if (!input.files?.[0]) return;
    const formData = new FormData();
    formData.append("photo", input.files[0]);
    try {
      const response = await fetch(`/api/admission/learners/photo-upload/${learnerId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Photo upload failed.");
      }
      alert("Photo uploaded successfully.");
      await loadModuleData(moduleConfigs.admission);
    } catch (error) {
      alert(error.message);
    }
  };
  input.click();
}

function viewLearnerRecord(learnerId) {
  openProtectedUrl(`/api/admission/learners/${learnerId}/export/pdf`);
}

function downloadLearnerRecord(learnerId) {
  openProtectedUrl(`/api/admission/learners/${learnerId}/export/pdf`);
}

function printLearnerRecord(learnerId) {
  openProtectedUrl(`/api/admission/learners/${learnerId}/export/pdf`);
}

function printAdmissionGroupedRegister() {
  const status = document.getElementById("admissionSearchStatus")?.value || "";
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  openProtectedUrl(`/api/admission/learners/register/print${query}`);
}

function printAdmissionCurrentTable() {
  if (!admissionSearchRows.length) {
    alert("No admission records loaded to print.");
    return;
  }
  const status = document.getElementById("admissionSearchStatus")?.value || "";
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  openProtectedUrl(`/api/admission/learners/register/print${query}`);
}

async function refreshAdmissionStatusSummary() {
  if (currentModule !== "admission") return;
  const status = document.getElementById("admissionSearchStatus")?.value || "";
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  try {
    const summary = await request(`/api/admission/learners/status-summary${suffix}`);
    renderAdmissionStatusSummary(summary);
  } catch (error) {
    renderAdmissionStatusSummary(null);
  }
}

function renderAdmissionTable(rows) {
  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");
  if (!rows.length) {
    head.innerHTML = "";
    body.innerHTML = "<tr><td>No learners found.</td></tr>";
    return;
  }

  head.innerHTML = `
    <tr>
      <th>Photo</th>
      <th>First Name</th>
      <th>Admission No</th>
      <th>Class Section</th>
      <th>UPI</th>
      <th>Assessment</th>
      <th>Birth Cert</th>
      <th>Status</th>
      <th>Parent</th>
      <th>Actions</th>
    </tr>
  `;

  body.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${
          row.passport_photo_path
            ? `<img src="${escapeHtml(row.passport_photo_path)}" alt="photo" class="photo-preview" />`
            : "<span class='small-note'>No photo</span>"
        }</td>
        <td>${escapeHtml(row.first_name || row.full_name || "")}</td>
        <td>${escapeHtml(row.admission_number || "")}</td>
        <td>${escapeHtml(row.grade || row.form_name || "")} ${escapeHtml(row.stream || "")}</td>
        <td>${escapeHtml(row.upi_number || "")}</td>
        <td>${escapeHtml(row.assessment_number || "")}</td>
        <td>${escapeHtml(row.birth_certificate_number || "")}</td>
        <td>${statusBadgeHtml(row.status)}</td>
        <td>${escapeHtml(row.parent_full_name || "")}<br/><span class="small-note">${escapeHtml(row.parent_phone || "")}</span></td>
        <td>
          <div class="table-actions">
            <button onclick="admissionAction('edit', ${row.id})">Edit</button>
            <button class="danger" onclick="admissionAction('delete', ${row.id})">Delete</button>
            <button onclick="admissionAction('uploadPhoto', ${row.id})">Photo</button>
            <button onclick="admissionAction('view', ${row.id})">View</button>
            <button onclick="admissionAction('download', ${row.id})">Download</button>
            <button onclick="admissionAction('print', ${row.id})">Print</button>
          </div>
        </td>
      </tr>
    `
    )
    .join("");
}

function renderTable(rows) {
  if (currentModule === "admission") {
    renderAdmissionTable(rows || []);
    return;
  }

  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");

  if (!rows.length) {
    head.innerHTML = "";
    body.innerHTML = "<tr><td>No records found.</td></tr>";
    return;
  }

  const allKeys = Object.keys(rows[0]).filter((key) => !["details_json", "generated_exam_text"].includes(key));
  const shownKeys = allKeys.slice(0, 10);
  head.innerHTML = `<tr>${shownKeys.map((key) => `<th>${key}</th>`).join("")}<th>Actions</th></tr>`;
  body.innerHTML = rows
    .map(
      (row) => `
      <tr>
        ${shownKeys.map((key) => `<td>${row[key] ?? ""}</td>`).join("")}
        <td>
          <button onclick="editRow(${row.id})">Edit</button>
          <button onclick="deleteRow(${row.id})" class="danger">Delete</button>
        </td>
      </tr>
    `
    )
    .join("");
}

async function loadModuleData(config) {
  try {
    const rows = await request(config.endpoint);
    if (currentModule === "admission") {
      admissionSearchRows = rows || [];
    }
    renderTable(rows || []);
    if (currentModule === "admission") {
      await refreshAdmissionStatusSummary();
    }
  } catch (error) {
    alert(error.message);
  }
}

function bindAdmissionTools() {
  const downloadTemplateButton = document.getElementById("downloadAdmissionTemplateButton");
  const downloadCsvTemplateButton = document.getElementById("downloadAdmissionCsvTemplateButton");
  const uploadExcelButton = document.getElementById("uploadAdmissionExcelButton");
  const downloadRejectionButton = document.getElementById("downloadAdmissionRejectionReportButton");
  const uploadPhotoBatchButton = document.getElementById("uploadAdmissionPhotoBatchButton");
  const uploadPhotoZipButton = document.getElementById("uploadAdmissionPhotoZipButton");
  const searchButton = document.getElementById("admissionSearchButton");
  const printRecordButton = document.getElementById("admissionRecordPrintButton");
  const groupedRegisterButton = document.getElementById("admissionGroupedRegisterButton");
  const refreshSummaryButton = document.getElementById("refreshAdmissionSummaryButton");
  if (downloadTemplateButton) downloadTemplateButton.onclick = downloadAdmissionTemplate;
  if (downloadCsvTemplateButton) downloadCsvTemplateButton.onclick = downloadAdmissionCsvTemplate;
  if (uploadExcelButton) uploadExcelButton.onclick = uploadAdmissionExcel;
  if (downloadRejectionButton) downloadRejectionButton.onclick = downloadAdmissionRejectionReport;
  if (uploadPhotoBatchButton) uploadPhotoBatchButton.onclick = uploadAdmissionPhotoBatch;
  if (uploadPhotoZipButton) uploadPhotoZipButton.onclick = uploadAdmissionPhotoZipBatch;
  if (searchButton) {
    searchButton.onclick = async () => {
      await searchAdmission();
      await refreshAdmissionStatusSummary();
    };
  }
  if (printRecordButton) printRecordButton.onclick = printAdmissionCurrentTable;
  if (groupedRegisterButton) groupedRegisterButton.onclick = printAdmissionGroupedRegister;
  if (refreshSummaryButton) refreshSummaryButton.onclick = refreshAdmissionStatusSummary;
}

function renderCrudModule(moduleKey) {
  const config = moduleConfigs[moduleKey];
  attachFieldMetadata(moduleKey, config);
  document.getElementById("moduleTitle").textContent = config.title;
  document.getElementById("cards").innerHTML = "";
  const extraTools = moduleKey === "admission" ? admissionToolsHtml() : "";
  const helpCard = renderModuleHelp(moduleKey);

  document.getElementById("formArea").innerHTML = `
    <h3>${config.title}</h3>
    ${helpCard}
    ${extraTools}
    <div class="form-grid">
      ${config.fields.map(buildInput).join("")}
    </div>
    <div class="actions-row">
      <button id="saveButton">Save</button>
      <button id="clearButton">Clear</button>
      <button id="processButton">Process</button>
      <button id="downloadPdfButton">Download PDF</button>
      <button id="downloadExcelButton">Download Excel</button>
      <button id="printButton">Print</button>
      <button id="viewButton">View</button>
    </div>
  `;

  document.getElementById("saveButton").onclick = saveCurrentModule;
  document.getElementById("clearButton").onclick = () => clearForm(config);
  document.getElementById("processButton").onclick = processCurrentModule;
  document.getElementById("downloadPdfButton").onclick = exportPdf;
  document.getElementById("downloadExcelButton").onclick = exportExcel;
  document.getElementById("printButton").onclick = () => window.print();
  document.getElementById("viewButton").onclick = () => loadModuleData(config);
  bindModuleHelpToggle();

  if (moduleKey === "admission") {
    bindAdmissionTools();
    bindAdmissionMutualExclusion();
  }

  loadModuleData(config);
}

function renderDashboardCards(stats) {
  document.getElementById("cards").innerHTML = Object.entries(stats)
    .map(
      ([key, value]) => `
      <div class="card stats-card">
        <h4>${key.replace(/([A-Z])/g, " $1")}</h4>
        <p>${value}</p>
      </div>
    `
    )
    .join("");
}

async function loadDashboard() {
  document.getElementById("moduleTitle").textContent = "Dashboard";
  try {
    const data = await request("/api/dashboard/summary");
    renderDashboardCards(data.stats || {});
    document.getElementById("formArea").innerHTML = `
      <h3>Daily Attendance List</h3>
      <pre>${JSON.stringify(data.attendanceBreakdown || [], null, 2)}</pre>
      <h3>Performance Per Class/Stream</h3>
      <pre>${JSON.stringify(data.performanceByClass || [], null, 2)}</pre>
      <h3>Alerts & Announcements</h3>
      <pre>${JSON.stringify(data.announcements || [], null, 2)}</pre>
      <h3>System Activity Logs</h3>
      <pre>${JSON.stringify(data.systemActivityLogs || [], null, 2)}</pre>
    `;
    renderTable([]);
  } catch (error) {
    alert(error.message);
  }
}

async function loadParentOrBomResults() {
  document.getElementById("moduleTitle").textContent = "Parent/BOM Results";
  document.getElementById("cards").innerHTML = "";
  document.getElementById("formArea").innerHTML = `
    <h3>Results View</h3>
    <div class="actions-row">
      <button id="exportParentPdf">Download Results PDF</button>
      <button id="printParent">Print</button>
    </div>
  `;
  document.getElementById("exportParentPdf").onclick = () =>
    openProtectedUrl("/api/parent/results/export/pdf");
  document.getElementById("printParent").onclick = () => window.print();

  try {
    const rows = await request("/api/parent/results");
    renderTable(rows || []);
  } catch (error) {
    document.getElementById("tableHead").innerHTML = "";
    document.getElementById("tableBody").innerHTML = `<tr><td>${error.message}</td></tr>`;
  }
}

async function loadLearnerMaterials() {
  document.getElementById("moduleTitle").textContent = "Learner Learning Materials and Marks";
  document.getElementById("cards").innerHTML = "";
  document.getElementById("formArea").innerHTML = `
    <h3>Learner Portal Resources</h3>
    <div class="actions-row">
      <button id="refreshLearner">Refresh</button>
      <button id="printLearner">Print</button>
    </div>
  `;
  document.getElementById("refreshLearner").onclick = loadLearnerMaterials;
  document.getElementById("printLearner").onclick = () => window.print();
  try {
    const [materials, marks] = await Promise.all([request("/api/learner/materials"), request("/api/learner/marks")]);
    renderTable([...(materials || []), ...(marks || [])]);
  } catch (error) {
    document.getElementById("tableHead").innerHTML = "";
    document.getElementById("tableBody").innerHTML = `<tr><td>${error.message}</td></tr>`;
  }
}

async function globalSearch() {
  const q = document.getElementById("globalSearch").value.trim();
  if (!q) return;
  try {
    const result = await request(`/api/search/global?q=${encodeURIComponent(q)}`);
    document.getElementById("moduleTitle").textContent = `Search Results: ${q}`;
    document.getElementById("cards").innerHTML = "";
    document.getElementById("formArea").innerHTML = `
      <h3>Search Result Summary</h3>
      <p><span class="tag">Learners: ${result.learners.length}</span>
      <span class="tag">Teachers: ${result.teachers.length}</span>
      <span class="tag">Parents/BOM: ${result.parentsAndBom.length}</span></p>
    `;
    renderTable([...(result.learners || []), ...(result.teachers || []), ...(result.parentsAndBom || [])]);
  } catch (error) {
    alert(error.message);
  }
}

async function changeCredentials() {
  const currentPassword = prompt("Enter current password:");
  if (!currentPassword) return;
  const newUsername = prompt("Enter new username (optional):") || null;
  const newPassword = prompt("Enter new password (optional):") || null;
  try {
    await request("/api/profile/change-credentials", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_username: newUsername,
        new_password: newPassword
      })
    });
    alert("Credentials updated successfully.");
  } catch (error) {
    alert(error.message);
  }
}

function bindSidebar() {
  document.querySelectorAll(".sidebar button[data-module]").forEach((button) => {
    button.addEventListener("click", async () => {
      currentModule = button.dataset.module;
      currentEditId = null;
      if (currentModule === "dashboard") return loadDashboard();
      if (currentModule === "parents-results") return loadParentOrBomResults();
      if (currentModule === "learner-materials") return loadLearnerMaterials();
      if (moduleConfigs[currentModule]) return renderCrudModule(currentModule);
      return null;
    });
  });
}

function bindTopbarButtons() {
  document.getElementById("searchButton").addEventListener("click", globalSearch);
  document.getElementById("logoutButton").addEventListener("click", () => {
    localStorage.clear();
    window.location.href = "/";
  });
  document.getElementById("changeCredentialsButton").addEventListener("click", changeCredentials);
}

window.admissionAction = async (action, learnerId) => {
  if (action === "edit") {
    await editRow(learnerId);
    return;
  }
  if (action === "delete") {
    await deleteRow(learnerId);
    return;
  }
  if (action === "uploadPhoto") {
    await uploadLearnerPhoto(learnerId);
    return;
  }
  if (action === "view") {
    viewLearnerRecord(learnerId);
    return;
  }
  if (action === "download") {
    downloadLearnerRecord(learnerId);
    return;
  }
  if (action === "print") {
    printLearnerRecord(learnerId);
  }
};

window.editRow = editRow;
window.deleteRow = deleteRow;

async function init() {
  try {
    [meta] = await Promise.all([request("/api/meta")]);
    const portalData = await request("/api/portal/current");
    document.getElementById("portalLabel").textContent = `${portalData.portal} (${portalData.role})`;
    bindSidebar();
    bindTopbarButtons();
    await loadDashboard();
  } catch (error) {
    alert(error.message);
  }
}

init();
