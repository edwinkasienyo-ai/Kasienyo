const token = localStorage.getItem("token");
if (!token) {
  window.location.href = "/";
}

let meta = {};
let currentModule = "dashboard";
let currentEditId = null;
let allowedModules = [];
const DASHBOARD_STAT_LABELS = {
  totalLearners: "Total Learners Population",
  totalPresent: "Present Today",
  totalAbsent: "Absent Today",
  totalBoys: "Total Boys",
  totalGirls: "Total Girls",
  totalLate: "Late Today",
  totalSuspended: "Suspended",
  totalExpelled: "Expelled",
  totalFeesCollectedToday: "Fees Collected Today (KES)"
};

const MODULE_KEY_BY_ID = {
  dashboard: "dashboard",
  admission: "admission",
  "management-teachers": "management-teachers",
  "management-non-teaching": "management-non-teaching",
  "management-teacher-resources": "management-teacher-resources",
  attendance: "attendance",
  "academic-exams": "academic-exams",
  "academic-marks": "academic-marks",
  "hr-leave": "hr-leave",
  "hr-recruitment": "hr-recruitment",
  "finance-fee-structure": "finance-fee-structure",
  "finance-fee-payments": "finance-fee-payments",
  "finance-procurement": "finance-procurement",
  "communication-announcements": "communication-announcements",
  "communication-messages": "communication-messages",
  "parents-results": "parent-results",
  "learner-materials": "learner-materials",
  "welfare-members": "welfare-members",
  "welfare-contributions": "welfare-contributions",
  "welfare-loans": "welfare-loans",
  laws: "laws"
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
      { name: "parent_relationship", label: "Parent Relationship", type: "select", optionsKey: "relationshipOptions" },
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
      { name: "attendance_type", label: "Attendance Type", type: "select", options: ["Teacher", "Learner", "Non-Teaching"] },
      { name: "person_id", label: "Person ID" },
      { name: "person_name", label: "Person Name" },
      { name: "grade", label: "Class/Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "stream", label: "Stream" },
      { name: "attendance_date", label: "Attendance Date/Time", type: "datetime-local" },
      { name: "time_in", label: "Time In", type: "datetime-local" },
      { name: "time_out", label: "Time Out", type: "datetime-local" },
      { name: "status", label: "Status", type: "select", options: ["Present", "Absent", "Late", "Official Duty", "Absent with Apology", "Absent with No Apology"] },
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
      { name: "staff_profile_type", label: "Staff Profile Type", type: "select", options: ["Teacher", "Non-Teaching Staff"] },
      { name: "staff_profile_id", label: "Staff Profile ID", type: "number" },
      { name: "staff_name", label: "Staff Name" },
      { name: "leave_type", label: "Leave Type", type: "select", optionsKey: "leaveTypes" },
      { name: "start_date", label: "Start Date", type: "date" },
      { name: "end_date", label: "End Date", type: "date" },
      { name: "reason", label: "Reason", type: "textarea" },
      { name: "status", label: "Status", type: "select", options: ["Pending", "Approved", "Rejected"] },
      { name: "approval_stage", label: "Approval Stage", type: "select", options: ["Member", "Loan Officer", "Principal", "Final"] }
    ]
  },
  "hr-recruitment": {
    title: "HR - Recruitment and Letters",
    endpoint: "/api/hr/recruitment-records",
    fields: [
      { name: "record_type", label: "Record Type", type: "select", options: ["Job Vacancy", "Shortlisting", "Appointment Letter", "Promotion Letter", "Suspension Letter", "Warning Letter", "Show Cause Letter", "Dismissal Letter", "Early Retirement"] },
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
      { name: "payment_method", label: "Payment Method", type: "select", options: ["Cash", "Bank", "Mpesa", "Cheque", "Other"] },
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
      { name: "audience", label: "Audience", type: "select", options: ["All", "Teachers", "Parents", "Learners", "Non-Teaching", "BOM"] },
      { name: "start_date", label: "Start Date", type: "date" },
      { name: "end_date", label: "End Date", type: "date" }
    ]
  },
  "communication-messages": {
    title: "Communication - SMS and Notifications",
    endpoint: "/api/communication/messages",
    fields: [
      { name: "message_type", label: "Message Type", type: "select", options: ["SMS", "Email", "Push", "Parent Result Notice", "Fee Reminder"] },
      { name: "recipient_role", label: "Recipient Role", type: "select", options: ["Parent", "Teacher", "Head", "Admin", "BOM", "Learner", "Non-Teaching"] },
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
      { name: "payment_mode", label: "Payment Mode", type: "select", options: ["Cash", "Bank", "Mpesa", "Payroll Deduction", "Other"] },
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
      { name: "status", label: "Overall Status", type: "select", options: ["Pending", "Approved", "Rejected", "Disbursed", "Closed"] },
      { name: "loan_officer_approval", label: "Loan Officer Approval", type: "select", options: ["Pending", "Approved", "Rejected"] },
      { name: "principal_approval", label: "Principal Approval", type: "select", options: ["Pending", "Approved", "Rejected"] },
      { name: "repayment_status", label: "Repayment Tracking", type: "select", options: ["Not Started", "In Progress", "Completed", "Defaulted"] }
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

  if (response.status === 401) {
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

function resetDataTable(message = "No records found.") {
  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");
  if (!head || !body) return;
  head.innerHTML = "";
  body.innerHTML = `<tr><td>${escapeHtml(message)}</td></tr>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}

function formatNumber(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toLocaleString() : "0";
}

function formatMoney(value) {
  const amount = Number(value ?? 0);
  const safe = Number.isFinite(amount) ? amount : 0;
  return `KES ${safe.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function buildDashboardTable(headers, rows) {
  if (!rows.length) {
    return '<p class="small-note">No records available.</p>';
  }
  return `
    <div class="dashboard-table-wrap">
      <table class="dashboard-table">
        <thead>
          <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function isModuleAllowed(moduleKey) {
  if (!moduleKey) return true;
  if (!Array.isArray(allowedModules) || !allowedModules.length) return true;
  return allowedModules.includes(moduleKey);
}

function isSidebarModuleAllowed(moduleId) {
  return isModuleAllowed(MODULE_KEY_BY_ID[moduleId] || moduleId);
}

function buildInput(field) {
  const id = `field-${field.name}`;
  const value = "";
  if (field.type === "textarea") {
    return `<label>${field.label}</label><textarea id="${id}" rows="3" placeholder="${field.label}">${value}</textarea>`;
  }
  if (field.type === "select") {
    const options = field.options || meta[field.optionsKey] || [];
    const optionHtml = ['<option value="">Select...</option>']
      .concat(options.map((option) => `<option value="${option}">${option}</option>`))
      .join("");
    return `<label>${field.label}</label><select id="${id}">${optionHtml}</select>`;
  }
  return `<label>${field.label}</label><input id="${id}" type="${field.type || "text"}" placeholder="${field.label}" value="${value}"/>`;
}

function getFieldValue(field) {
  const el = document.getElementById(`field-${field.name}`);
  if (!el) return null;
  if (field.type === "number") {
    return el.value === "" ? null : Number(el.value);
  }
  return el.value || null;
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

async function saveCurrentModule() {
  const config = moduleConfigs[currentModule];
  if (!config) return;
  if (!isModuleAllowed(currentModule)) {
    alert("Your role does not have access to this module.");
    return;
  }

  const payload = {};
  config.fields.forEach((field) => {
    payload[field.name] = getFieldValue(field);
  });

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
      alert("Record updated successfully.");
    } else {
      await request(config.endpoint, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      alert("Record saved successfully.");
    }
    clearForm(config);
    await loadModuleData(config);
  } catch (error) {
    alert(error.message);
  }
}

async function editRow(id) {
  const config = moduleConfigs[currentModule];
  if (!config) return;
  if (!isModuleAllowed(currentModule)) {
    alert("Your role does not have access to this module.");
    return;
  }
  try {
    const row = await request(`${config.endpoint}/${id}`);
    currentEditId = row.id;
    config.fields.forEach((field) => setFieldValue(field, row[field.name]));
  } catch (error) {
    alert(error.message);
  }
}

async function deleteRow(id) {
  const config = moduleConfigs[currentModule];
  if (!config) return;
  if (!isModuleAllowed(currentModule)) {
    alert("Your role does not have access to this module.");
    return;
  }
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
  if (!isModuleAllowed(currentModule)) {
    alert("Your role does not have access to this module.");
    return;
  }
  window.open(`${config.endpoint}/export/pdf`, "_blank");
}

async function exportExcel() {
  const config = moduleConfigs[currentModule];
  if (!config) return;
  if (!isModuleAllowed(currentModule)) {
    alert("Your role does not have access to this module.");
    return;
  }
  window.open(`${config.endpoint}/export/excel`, "_blank");
}

function renderTable(rows) {
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
    renderTable(rows || []);
  } catch (error) {
    alert(error.message);
  }
}

function renderCrudModule(moduleKey) {
  const config = moduleConfigs[moduleKey];
  document.getElementById("moduleTitle").textContent = config.title;
  document.getElementById("cards").innerHTML = "";
  document.getElementById("formArea").innerHTML = `
    <h3>${config.title}</h3>
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
  document.getElementById("processButton").onclick = () => alert("Processing completed for this module.");
  document.getElementById("downloadPdfButton").onclick = exportPdf;
  document.getElementById("downloadExcelButton").onclick = exportExcel;
  document.getElementById("printButton").onclick = () => window.print();
  document.getElementById("viewButton").onclick = () => loadModuleData(config);
  loadModuleData(config);
}

function renderDashboardCards(stats) {
  document.getElementById("cards").innerHTML = Object.entries(stats)
    .map(
      ([key, value]) => `
      <div class="card stats-card">
        <h4>${DASHBOARD_STAT_LABELS[key] || key.replace(/([A-Z])/g, " $1")}</h4>
        <p>${key.toLowerCase().includes("fee") ? formatMoney(value) : formatNumber(value)}</p>
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
    const attendanceRows = (data.dailyAttendanceList || []).slice(0, 40).map((row) => [
      row.attendance_type || "-",
      row.person_name || "-",
      row.person_id || "-",
      row.grade || "-",
      row.stream || "-",
      row.status || "-",
      row.reason || "-",
      formatDateTime(row.attendance_date),
      formatDateTime(row.time_in),
      formatDateTime(row.time_out)
    ]);
    const performanceRows = (data.performanceByClass || []).map((row) => [
      row.grade || "-",
      row.stream || "-",
      formatNumber(row.totalLearners),
      formatNumber(row.totalEntries),
      formatNumber(row.meanScore),
      formatNumber(row.lowestScore),
      formatNumber(row.highestScore)
    ]);
    const recentPaymentsRows = (data.feeCollectionSummary?.recentPayments || []).map((row) => [
      row.learner_name || "-",
      row.admission_number || "-",
      row.grade || "-",
      row.stream || "-",
      formatMoney(row.amount_paid),
      row.payment_method || "-",
      row.receipt_number || "-",
      formatDateTime(row.payment_date),
      formatMoney(row.balance_after_payment)
    ]);
    const outstandingRows = (data.feeCollectionSummary?.outstandingBalances || []).map((row) => [
      row.learner_name || "-",
      row.admission_number || "-",
      row.grade || "-",
      row.stream || "-",
      formatMoney(row.balance)
    ]);
    const alertsMarkup = (data.alerts || [])
      .map(
        (alert) => `
        <div class="dashboard-alert ${escapeHtml(alert.severity || "info")}">
          <strong>${escapeHtml(alert.title || "Alert")}</strong>
          <p>${escapeHtml(alert.message || "")}</p>
        </div>
      `
      )
      .join("");
    const announcementMarkup = (data.announcements || [])
      .map(
        (item) => `
        <div class="dashboard-announcement">
          <h4>${escapeHtml(item.title || "Announcement")}</h4>
          <p>${escapeHtml(item.message || "")}</p>
          <small>
            Audience: ${escapeHtml(item.audience || "All")} | Posted: ${escapeHtml(formatDateTime(item.created_at))}
          </small>
        </div>
      `
      )
      .join("");
    const logRows = (data.systemActivityLogs || []).map((row) => [
      formatDateTime(row.created_at),
      row.actor_role || "-",
      row.action || "-",
      row.entity_name || "-",
      row.entity_id || "-"
    ]);
    const feeSummary = data.feeCollectionSummary || {};
    document.getElementById("formArea").innerHTML = `
      <div class="dashboard-grid">
        <section class="dashboard-section">
          <h3>Daily Attendance List</h3>
          <p class="small-note">Showing up to 40 latest records for today.</p>
          ${buildDashboardTable(
            ["Type", "Name", "Person ID", "Grade", "Stream", "Status", "Reason", "Attendance Time", "Time In", "Time Out"],
            attendanceRows
          )}
        </section>
        <section class="dashboard-section">
          <h3>Performance by Class/Grade & Stream</h3>
          ${buildDashboardTable(
            ["Grade", "Stream", "Learners", "Entries", "Mean", "Lowest", "Highest"],
            performanceRows
          )}
        </section>
        <section class="dashboard-section">
          <h3>Fee Collection Summary</h3>
          <div class="dashboard-metrics">
            <p><strong>Today:</strong> ${escapeHtml(formatMoney(feeSummary.todayTotal))} (${escapeHtml(formatNumber(feeSummary.todayPaymentsCount))} payment(s))</p>
            <p><strong>Month to Date:</strong> ${escapeHtml(formatMoney(feeSummary.monthTotal))} (${escapeHtml(formatNumber(feeSummary.monthPaymentsCount))} payment(s))</p>
            <p><strong>Year Total:</strong> ${escapeHtml(formatMoney(feeSummary.yearTotal))}</p>
            <p><strong>Year Target:</strong> ${escapeHtml(formatMoney(feeSummary.yearExpected))}</p>
            <p><strong>Variance:</strong> ${escapeHtml(formatMoney(feeSummary.yearVariance))}</p>
            <p><strong>Outstanding Balance:</strong> ${escapeHtml(formatMoney(feeSummary.outstandingBalanceTotal))} (${escapeHtml(formatNumber(feeSummary.learnersWithOutstandingBalance))} learner(s))</p>
          </div>
          <h4>Recent Fee Payments</h4>
          ${buildDashboardTable(
            ["Learner", "Adm No", "Grade", "Stream", "Amount", "Method", "Receipt", "Payment Date", "Balance"],
            recentPaymentsRows
          )}
          <h4>Learners with Outstanding Balances</h4>
          ${buildDashboardTable(["Learner", "Adm No", "Grade", "Stream", "Balance"], outstandingRows)}
        </section>
        <section class="dashboard-section">
          <h3>Alerts & Announcements</h3>
          <h4>System Alerts</h4>
          <div class="dashboard-alerts">
            ${alertsMarkup || '<p class="small-note">No alerts for today.</p>'}
          </div>
          <h4>Active Announcements</h4>
          <div class="dashboard-announcements">
            ${announcementMarkup || '<p class="small-note">No active announcements.</p>'}
          </div>
        </section>
        <section class="dashboard-section">
          <h3>System Activity Logs</h3>
          ${buildDashboardTable(["When", "Actor Role", "Action", "Entity", "Entity ID"], logRows)}
        </section>
      </div>
    `;
    document.getElementById("tableHead").innerHTML = "";
    document.getElementById("tableBody").innerHTML = "";
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
    window.open("/api/parent/results/export/pdf", "_blank");
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
    const [materials, marks] = await Promise.all([
      request("/api/learner/materials"),
      request("/api/learner/marks")
    ]);
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
      <div class="dashboard-section">
        <h4>Filter Search Results</h4>
        <div class="search-filter-grid">
          <div>
            <label for="searchScope">Scope</label>
            <select id="searchScope">
              <option value="all">All</option>
              <option value="learners">Learners</option>
              <option value="teachers">Teachers</option>
              <option value="parents-bom">Parents/BOM</option>
            </select>
          </div>
          <div>
            <label for="searchGradeFilter">Grade</label>
            <input id="searchGradeFilter" placeholder="e.g. Grade 7" />
          </div>
          <div>
            <label for="searchStreamFilter">Stream</label>
            <input id="searchStreamFilter" placeholder="e.g. Blue" />
          </div>
          <div>
            <label for="searchStatusFilter">Status</label>
            <input id="searchStatusFilter" placeholder="e.g. In Session, Active" />
          </div>
          <div>
            <label for="searchRoleFilter">Role</label>
            <input id="searchRoleFilter" placeholder="e.g. TEACHER, BOM, PARENT" />
          </div>
        </div>
        <div class="actions-row">
          <button id="applySearchFiltersButton">Apply Filters</button>
          <button id="clearSearchFiltersButton">Clear Filters</button>
        </div>
      </div>
    `;
    const learnersData = Array.isArray(result.learners) ? result.learners : [];
    const teachersData = Array.isArray(result.teachers) ? result.teachers : [];
    const parentsBomData = Array.isArray(result.parentsAndBom) ? result.parentsAndBom : [];
    let combinedRows = [...learnersData, ...teachersData, ...parentsBomData];
    renderTable(combinedRows);

    const applyFilters = () => {
      const scope = (document.getElementById("searchScope")?.value || "all").toLowerCase();
      const gradeFilter = (document.getElementById("searchGradeFilter")?.value || "").trim().toLowerCase();
      const streamFilter = (document.getElementById("searchStreamFilter")?.value || "").trim().toLowerCase();
      const statusFilter = (document.getElementById("searchStatusFilter")?.value || "").trim().toLowerCase();
      const roleFilter = (document.getElementById("searchRoleFilter")?.value || "").trim().toLowerCase();

      const sourceRows =
        scope === "learners"
          ? learnersData
          : scope === "teachers"
            ? teachersData
            : scope === "parents-bom"
              ? parentsBomData
              : combinedRows;
      const filteredRows = sourceRows.filter((row) => {
        const rowRole = String(row.role || "").toLowerCase();
        const rowGrade = String(row.grade || "").toLowerCase();
        const rowStream = String(row.stream || "").toLowerCase();
        const rowStatus = String(row.status || "").toLowerCase();
        if (gradeFilter && !rowGrade.includes(gradeFilter)) return false;
        if (streamFilter && !rowStream.includes(streamFilter)) return false;
        if (statusFilter && !rowStatus.includes(statusFilter)) return false;
        if (roleFilter && !rowRole.includes(roleFilter)) return false;
        return true;
      });
      renderTable(filteredRows);
      if (!filteredRows.length) {
        resetDataTable("No records match your selected filters.");
      }
    };

    document.getElementById("applySearchFiltersButton")?.addEventListener("click", applyFilters);
    document.getElementById("clearSearchFiltersButton")?.addEventListener("click", () => {
      ["searchGradeFilter", "searchStreamFilter", "searchStatusFilter", "searchRoleFilter"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      const scopeEl = document.getElementById("searchScope");
      if (scopeEl) scopeEl.value = "all";
      renderTable(combinedRows);
    });
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

function renderPasswordPolicyBanner(user = {}, portal = {}) {
  const formArea = document.getElementById("formArea");
  const banner = document.getElementById("passwordExpiryNotice");
  if (banner) {
    banner.textContent = "";
    banner.className = "small-note";
  }
  if (!formArea) return;
  if (user.role === "SYSTEM_DEVELOPER") return;

  const expiresAt = user.password_expires_at;
  let daysRemaining = Number(user.password_days_remaining ?? NaN);
  if (Number.isNaN(daysRemaining) && expiresAt) {
    const expiryDate = new Date(expiresAt);
    if (!Number.isNaN(expiryDate.getTime())) {
      const diffMs = expiryDate.getTime() - Date.now();
      daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }
  }
  if (!Number.isFinite(daysRemaining)) return;

  const severity =
    daysRemaining <= 3 ? "error" : daysRemaining <= 10 ? "warning" : "info";
  const message =
    daysRemaining <= 0
      ? "Your password has expired. Change it immediately."
      : `Password policy notice: ${daysRemaining} day(s) remaining before password expiry.`;
  if (banner) {
    banner.textContent = message;
    banner.className = `small-note ${severity}`;
  }
}

function bindSidebar() {
  document.querySelectorAll(".sidebar button[data-module]").forEach((button) => {
    if (!isSidebarModuleAllowed(button.dataset.module)) {
      button.style.display = "none";
      return;
    }
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
  document
    .getElementById("changeCredentialsButton")
    .addEventListener("click", changeCredentials);
}

async function init() {
  try {
    [meta] = await Promise.all([request("/api/meta")]);
    const portalData = await request("/api/portal/current");
    allowedModules = Array.isArray(portalData?.allowed_modules) ? portalData.allowed_modules : [];
    const meData = await request("/api/auth/me");
    document.getElementById("portalLabel").textContent = `${portalData.portal} (${portalData.role})`;
    bindSidebar();
    bindTopbarButtons();
    await loadDashboard();
    renderPasswordPolicyBanner(meData, portalData);
    if (meData?.must_change_password) {
      alert("Password policy notice: your password was reset and must be changed immediately.");
    }
  } catch (error) {
    alert(error.message);
  }
}

window.editRow = editRow;
window.deleteRow = deleteRow;
init();
