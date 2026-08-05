// Google Apps Script Backend for 2027 Project Planned Budget Planner
// Copy and paste this code in your Google Apps Script editor (Extensions -> Apps Script from your Google Sheet).
// Be sure to deploy this as a "Web App", executed as "Me", with access set to "Anyone".

const DATABASE_SHEET_NAME   = "BudgetDatabase";
const EMPLOYEE_SHEET_NAME   = "EmployeeIDs";
const DEPARTMENT_SHEET_NAME = "Divisions";
const LOG_SHEET_NAME        = "ChangeLog";
const TARGET_SPREADSHEET_ID = "1jK1AyCzoZzRZn_l-bNFwsV6Zz7dg7hSm2UY7u5sN0Xo";

// Pre-seeded divisions (used when the Divisions sheet is first created / empty)
const DEFAULT_DIVISIONS = [
  "BOD", "COLL", "COO", "CORFIN", "CORSEC", "FAT", "GCR", "HC&GA", "IT",
  "LEGAL", "MARKETING", "PAYROLL", "PROC", "PROJECT", "QS", "SALES", "TECHPLAN"
];

// Canonical budget module keys (used for department module access)
const BUDGET_MODULES = [
  "target-revenue", "sales-cost", "marketing-activity", "dev-land",
  "employee-hc", "ga-others", "corp-event",
  "fixed-assets", "business-trip"
];

/**
 * RUN THIS FUNCTION ONCE IN APPS SCRIPT EDITOR!
 * Automatically initializes and creates all required sheet tabs:
 * 1. BudgetDatabase (for saving JSON budget records, keyed by Company + Project + Division)
 * 2. EmployeeIDs (for user NIK login & permissions)
 * 3. Divisions (division-level module & project access, set by super admin)
 * 4. ChangeLog (for audit trail)
 */
function setupAllSheets() {
  const dbSheet = getDatabaseSheet();
  const empSheet = getEmployeeSheet();
  const deptSheet = getDepartmentsSheet();
  const logSheet = getLogSheet();

  Logger.log("Successfully created/verified all tabs:");
  Logger.log("- " + dbSheet.getName());
  Logger.log("- " + empSheet.getName() + " (Default Admin NIK: 1001)");
  Logger.log("- " + deptSheet.getName());
  Logger.log("- " + logSheet.getName());
}

function doGet(e) {
  const action = e.parameter.action;
  const company = e.parameter.company;
  const project = e.parameter.project;
  const department = e.parameter.department || '';
  const nik = e.parameter.nik;

  if (action === 'get') {
      const data = getBudgetData(company, project, department);
      return createJsonResponse({ status: 'success', data: data });
  } else if (action === 'export') {
      try {
        const url = exportBudgetXlsx(company, project);
        return createJsonResponse({ status: 'success', exportUrl: url });
      } catch (err) {
        return createJsonResponse({ status: 'error', message: err.toString() });
      }
  } else if (action === 'loginNik') {
      const user = verifyNikLogin(nik);
      if (user) {
        return createJsonResponse({ status: 'success', user: user });
      } else {
        return createJsonResponse({ status: 'error', message: 'NIK not found or unauthorized' });
      }
  } else if (action === 'listEmployees') {
      const deptFilter = e.parameter.department || '';
      const ids = listEmployeeIDs(deptFilter);
      return createJsonResponse({ status: 'success', data: ids });
  } else if (action === 'listDepartments') {
      const depts = listDepartments();
      return createJsonResponse({ status: 'success', data: depts });
  } else if (action === 'summary') {
      const scope = e.parameter.scope || 'all';
      const department = e.parameter.department || '';
      const project = e.parameter.project || '';
      const result = getBudgetSummary(scope, department, project);
      return createJsonResponse({ status: 'success', data: result.data, meta: result.meta });
  }

  return createJsonResponse({ status: 'error', message: 'Invalid action specified' });
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    if (action === 'save') {
        const company = payload.company;
        const project = payload.project;
        const department = payload.department || '';
        const budgetData = payload.data;

        // Server-side authorization: no caller identity => reject. Read-only roles
        // (Viewer/FAT) cannot save. Non-Admins may only write their OWN division.
        const caller = payload.callerNik ? verifyNikLogin(payload.callerNik) : null;
        if (!caller) {
            return createJsonResponse({ status: 'error', message: 'Authentication required: callerNik is missing or invalid' });
        }
        if (caller.role === 'Viewer' || caller.role === 'FAT') {
            return createJsonResponse({ status: 'error', message: 'Read-only role (' + caller.role + ') cannot save budget data' });
        }
        if (caller.role !== 'Admin' && String(caller.department || '').trim().toLowerCase() !== String(department || '').trim().toLowerCase()) {
            return createJsonResponse({ status: 'error', message: 'Not authorized to save budget for division ' + (department || '(none)') });
        }

        saveBudgetData(company, project, department, budgetData);
        logChange(company, project, "SaveBudget", "Budget updated by " + (caller.employeeId || '?') + " (Div: " + (department || '-') + ")");
        return createJsonResponse({ status: 'success', message: 'Budget committed successfully' });
    } else if (action === 'addEmployee') {
        const { employeeId, name, allowedProjects, allowedCompanies, role, department, callerNik } = payload;
        addEmployeeID(employeeId, name, allowedProjects, allowedCompanies, role, department || '', callerNik);
        return createJsonResponse({ status: 'success', message: 'Employee ID added' });
    } else if (action === 'deleteEmployee') {
        const { employeeId, callerNik } = payload;
        deleteEmployeeID(employeeId, callerNik);
        return createJsonResponse({ status: 'success', message: 'Employee ID deleted' });
    } else if (action === 'saveDepartment') {
        // Division access management is super-admin only
        const caller = payload.callerNik ? verifyNikLogin(payload.callerNik) : null;
        if (!caller || caller.role !== 'Admin') {
            return createJsonResponse({ status: 'error', message: 'Only Super Admin may modify division access' });
        }
        const { department, allowedModules, allowedProjects, allowedCompanies } = payload;
        saveDepartment(department, allowedModules, allowedProjects, allowedCompanies);
        return createJsonResponse({ status: 'success', message: 'Division access saved' });
    } else if (action === 'deleteDepartment') {
        // Division deletion is super-admin only
        const caller = payload.callerNik ? verifyNikLogin(payload.callerNik) : null;
        if (!caller || caller.role !== 'Admin') {
            return createJsonResponse({ status: 'error', message: 'Only Super Admin may delete divisions' });
        }
        const { department } = payload;
        deleteDepartment(department);
        return createJsonResponse({ status: 'success', message: 'Division deleted' });
    }

    return createJsonResponse({ status: 'error', message: 'Invalid action specified' });
  } catch (err) {
      return createJsonResponse({ status: 'error', message: 'Failed to process request: ' + err.toString() });
  }
}

// ----------------------------------------------------
// DATABASE OPERATION CORE METHODS
// ----------------------------------------------------
function getSpreadsheet() {
  return SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
}

function getDatabaseSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(DATABASE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DATABASE_SHEET_NAME);
    // Initialize headers (Division added last for backward compatibility with legacy rows)
    sheet.appendRow(["Company", "Project", "LastUpdated", "BudgetDataJSON", "Division"]);
    // Freeze header row
    sheet.setFrozenRows(1);
  } else {
    // Rename legacy "Department" header (cosmetic; reads are position-based)
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (let c = 0; c < headers.length; c++) {
      if (String(headers[c] || '').trim() === 'Department') {
        sheet.getRange(1, c + 1).setValue('Division');
        break;
      }
    }
  }
  return sheet;
}

// Get or create Employee IDs sheet with permissions schema
function getEmployeeSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(EMPLOYEE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(EMPLOYEE_SHEET_NAME);
    sheet.appendRow(["EmployeeID", "EmployeeName", "AllowedProjects", "AllowedCompanies", "Role", "CreatedAt", "Division"]);
    sheet.setFrozenRows(1);
    // Add default admin row
    sheet.appendRow(["1001", "Administrator", "ALL", "ALL", "Admin", new Date(), ""]);
  } else {
    // Ensure Division header exists for upgraded sheets (legacy header was "Department")
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    let deptCol = -1;
    for (let c = 0; c < headers.length; c++) {
      if (String(headers[c] || '').trim() === 'Division') { deptCol = c; break; }
    }
    if (deptCol === -1) {
      // Look for legacy "Department" header and rename it in place
      for (let c = 0; c < headers.length; c++) {
        if (String(headers[c] || '').trim() === 'Department') {
          sheet.getRange(1, c + 1).setValue('Division');
          deptCol = c;
          break;
        }
      }
      if (deptCol === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue('Division');
      }
    }
  }
  return sheet;
}

// Get or create Divisions sheet (renamed from "Departments" - migrates existing data)
function getDepartmentsSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(DEPARTMENT_SHEET_NAME);
  if (!sheet) {
    // Migrate legacy "Departments" sheet in place (keeps all rows)
    const old = ss.getSheetByName("Departments");
    if (old) {
      old.setName(DEPARTMENT_SHEET_NAME);
      sheet = old;
    } else {
      sheet = ss.insertSheet(DEPARTMENT_SHEET_NAME);
      sheet.appendRow(["Division", "AllowedModules", "AllowedProjects", "AllowedCompanies", "CreatedAt"]);
      sheet.setFrozenRows(1);
    }
  }
  // Seed default divisions when the sheet is empty
  if (sheet.getLastRow() <= 1) {
    const now = new Date();
    DEFAULT_DIVISIONS.forEach(function (div) {
      sheet.appendRow([div, "ALL", "ALL", "ALL", now]);
    });
    logChange("System", "System", "SeedDivisions", DEFAULT_DIVISIONS.length + " default divisions created");
  }
  return sheet;
}

// Get or create Change Log sheet
function getLogSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET_NAME);
    sheet.appendRow(["Timestamp", "Company", "Project", "Action", "Details"]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logChange(company, project, action, details) {
  const sheet = getLogSheet();
  const timestamp = new Date();
  sheet.appendRow([timestamp, company || "System", project || "System", action, details]);
}

// NIK Login Verification (enriched with department-level access)
function verifyNikLogin(nik) {
  if (!nik) return null;
  const sheet = getEmployeeSheet();
  const rows = sheet.getDataRange().getValues();
  const searchNik = String(nik).trim().toLowerCase();

  for (let i = 1; i < rows.length; i++) {
    const rowNik = String(rows[i][0]).trim().toLowerCase();
    if (rowNik === searchNik) {
      const department = String(rows[i][6] || '').trim();
      const deptAccess = getDepartmentByName(department);

      return {
        employeeId: String(rows[i][0]),
        name: rows[i][1] || "Employee",
        allowedProjects: String(rows[i][2] || "ALL"),
        allowedCompanies: String(rows[i][3] || "ALL"),
        role: rows[i][4] || "User",
        department: department,
        allowedModules: deptAccess ? deptAccess.allowedModules : 'ALL',
        deptAllowedProjects: deptAccess ? deptAccess.allowedProjects : 'ALL',
        deptAllowedCompanies: deptAccess ? deptAccess.allowedCompanies : 'ALL'
      };
    }
  }
  return null;
}

function getDepartmentByName(department) {
  if (!department) return null;
  const sheet = getDepartmentsSheet();
  const rows = sheet.getDataRange().getValues();
  const search = String(department).trim().toLowerCase();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim().toLowerCase() === search) {
      return {
        department: String(rows[i][0]),
        allowedModules: String(rows[i][1] || 'ALL'),
        allowedProjects: String(rows[i][2] || 'ALL'),
        allowedCompanies: String(rows[i][3] || 'ALL'),
        createdAt: rows[i][4]
      };
    }
  }
  return null;
}

// Employee ID CRUD operations with role & department scoping checks
function addEmployeeID(employeeId, name, allowedProjects, allowedCompanies, role, department, callerNik) {
  // If callerNik is passed, verify caller permissions server-side
  if (callerNik) {
    const caller = verifyNikLogin(callerNik);
    if (caller) {
      if (caller.role === 'DeptHead') {
        // DeptHead can only assign their own department and non-admin roles
        department = caller.department || '';
        if (role === 'Admin' || role === 'DeptHead' || role === 'FAT') {
          role = 'User';
        }
      }
    }
  }

  const sheet = getEmployeeSheet();
  const timestamp = new Date();
  const projStr = Array.isArray(allowedProjects) ? allowedProjects.join(",") : (allowedProjects || "ALL");
  const compStr = Array.isArray(allowedCompanies) ? allowedCompanies.join(",") : (allowedCompanies || "ALL");

  // Check if exists to update
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(employeeId).trim()) {
      // Protect Admin rows from non-admin callers
      const existingRole = rows[i][4] || "User";
      if (existingRole === 'Admin' && callerNik) {
        const caller = verifyNikLogin(callerNik);
        if (!caller || caller.role !== 'Admin') {
          throw new Error("Unauthorized to modify Admin permissions");
        }
      }
      // Dept heads must never be able to silently alter privileged accounts
      // (their role select only offers User/Viewer — editing a DeptHead/FAT row
      // would otherwise demote it to User)
      if ((existingRole === 'Admin' || existingRole === 'DeptHead' || existingRole === 'FAT') && callerNik) {
        const caller = verifyNikLogin(callerNik);
        if (caller && caller.role === 'DeptHead') {
          throw new Error("Unauthorized to modify privileged accounts");
        }
      }

      sheet.getRange(i + 1, 2).setValue(name || "Employee");
      sheet.getRange(i + 1, 3).setValue(projStr);
      sheet.getRange(i + 1, 4).setValue(compStr);
      sheet.getRange(i + 1, 5).setValue(role || "User");
      if (department !== undefined) {
        sheet.getRange(i + 1, 7).setValue(department);
      }
      logChange("System", "System", "UpdateEmployeeID", employeeId + " (" + name + ") Div: " + (department || '-'));
      return;
    }
  }

  sheet.appendRow([employeeId, name || "Employee", projStr, compStr, role || "User", timestamp, department || '']);
  logChange("System", "System", "AddEmployeeID", employeeId + " (" + name + ") Div: " + (department || '-'));
}

function deleteEmployeeID(employeeId, callerNik) {
  if (callerNik) {
    const caller = verifyNikLogin(callerNik);
    if (caller && caller.role === 'DeptHead' && String(caller.employeeId).trim() === String(employeeId).trim()) {
      throw new Error("Dept Heads cannot delete their own account");
    }
  }

  const sheet = getEmployeeSheet();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(employeeId).trim()) {
      const existingRole = rows[i][4] || "User";
      if (existingRole === 'Admin' && callerNik) {
        const caller = verifyNikLogin(callerNik);
        if (!caller || caller.role !== 'Admin') {
          throw new Error("Unauthorized to delete Admin user");
        }
      }

      // Dept heads may only delete employees within their own division
      if (callerNik) {
        const caller = verifyNikLogin(callerNik);
        if (caller && caller.role === 'DeptHead') {
          const targetDept = String(rows[i][6] || '').trim().toLowerCase();
          const callerDept = String(caller.department || '').trim().toLowerCase();
          if (targetDept !== callerDept) {
            throw new Error("Unauthorized to delete users outside your division");
          }
        }
      }

      sheet.deleteRow(i + 1);
      logChange("System", "System", "DeleteEmployeeID", employeeId);
      return;
    }
  }
}

function listEmployeeIDs(deptFilter) {
  const sheet = getEmployeeSheet();
  const rows = sheet.getDataRange().getValues();
  const list = [];
  const filter = deptFilter ? String(deptFilter).trim().toLowerCase() : '';
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) {
      const department = String(rows[i][6] || '').trim();
      if (filter && department.toLowerCase() !== filter) continue;
      list.push({
        employeeId: String(rows[i][0]),
        name: rows[i][1] || "Employee",
        allowedProjects: String(rows[i][2] || "ALL"),
        allowedCompanies: String(rows[i][3] || "ALL"),
        role: rows[i][4] || "User",
        createdAt: rows[i][5],
        department: department
      });
    }
  }
  return list;
}

// Department CRUD operations (super admin)
function listDepartments() {
  const sheet = getDepartmentsSheet();
  const rows = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) {
      list.push({
        department: String(rows[i][0]),
        allowedModules: String(rows[i][1] || 'ALL'),
        allowedProjects: String(rows[i][2] || 'ALL'),
        allowedCompanies: String(rows[i][3] || 'ALL'),
        createdAt: rows[i][4]
      });
    }
  }
  return list;
}

function saveDepartment(department, allowedModules, allowedProjects, allowedCompanies) {
  const sheet = getDepartmentsSheet();
  const timestamp = new Date();
  const modStr = Array.isArray(allowedModules) ? allowedModules.join(",") : (allowedModules || "ALL");
  const projStr = Array.isArray(allowedProjects) ? allowedProjects.join(",") : (allowedProjects || "ALL");
  const compStr = Array.isArray(allowedCompanies) ? allowedCompanies.join(",") : (allowedCompanies || "ALL");

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === String(department).trim().toLowerCase()) {
      sheet.getRange(i + 1, 2).setValue(modStr);
      sheet.getRange(i + 1, 3).setValue(projStr);
      sheet.getRange(i + 1, 4).setValue(compStr);
      logChange("System", "System", "UpdateDivision", department + " | Modules: " + modStr);
      return;
    }
  }

  sheet.appendRow([department, modStr, projStr, compStr, timestamp]);
  logChange("System", "System", "AddDivision", department + " | Modules: " + modStr);
}

function deleteDepartment(department) {
  const sheet = getDepartmentsSheet();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === String(department).trim().toLowerCase()) {
      sheet.deleteRow(i + 1);
      // Unassign employees of this department so they must be re-assigned
      const empSheet = getEmployeeSheet();
      const empRows = empSheet.getDataRange().getValues();
      for (let j = 1; j < empRows.length; j++) {
        if (String(empRows[j][6] || '').trim().toLowerCase() === String(department).trim().toLowerCase()) {
          empSheet.getRange(j + 1, 7).setValue('');
        }
      }
      logChange("System", "System", "DeleteDivision", department);
      return;
    }
  }
}

// Budget data keyed by Company + Project + Department
function getBudgetData(company, project, department) {
  const sheet = getDatabaseSheet();
  const rows = sheet.getDataRange().getValues();
  const deptStr = department ? String(department).trim().toLowerCase() : '';

  // 1) Exact match on Company + Project + Department
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === company && rows[i][1] === project && String(rows[i][4] || '').trim().toLowerCase() === deptStr) {
      try {
        return JSON.parse(rows[i][3]);
      } catch (err) {
        return null;
      }
    }
  }

  // 2) Legacy fallback: Company + Project row without a department (pre-migration data)
  if (deptStr) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === company && rows[i][1] === project && !String(rows[i][4] || '').trim()) {
        try {
          return JSON.parse(rows[i][3]);
        } catch (err) {
          return null;
        }
      }
    }
  }

  return null;
}

function saveBudgetData(company, project, department, budgetData) {
  const sheet = getDatabaseSheet();
  const rows = sheet.getDataRange().getValues();
  const dataString = JSON.stringify(budgetData);
  const timestamp = new Date();
  const deptStr = department ? String(department).trim() : '';

  // Search if exact row exists to overwrite (Company + Project + Department)
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === company && rows[i][1] === project && String(rows[i][4] || '').trim() === deptStr) {
      sheet.getRange(i + 1, 3).setValue(timestamp);
      sheet.getRange(i + 1, 4).setValue(dataString);
      return;
    }
  }

  // Create new row
  sheet.appendRow([company, project, timestamp, dataString, deptStr]);
  return;
}

// ----------------------------------------------------
// CONSOLIDATED SUMMARY (server-side aggregation)
// ----------------------------------------------------
// Generic deep merge for budget JSON blobs:
//  - numbers            -> summed
//  - arrays of numbers  -> element-wise sum
//  - arrays of objects  -> concatenated (dynamic rows: target revenue, capex, trips)
//  - objects            -> merged recursively by key
//  - strings / booleans -> first non-empty value wins
function mergeBudgetData(rows) {
  const merged = {};

  function mergeInto(target, src) {
    if (src === null || src === undefined) return target;
    if (Array.isArray(src)) {
      const t = (target === undefined || target === null) ? [] : target;
      // Numeric arrays (12-month series): sum element-wise
      if (src.every(function (x) { return typeof x === 'number'; })) {
        for (let i = 0; i < src.length; i++) {
          t[i] = (t[i] || 0) + src[i];
        }
        return t;
      }
      // Arrays of objects (dynamic rows): concatenate
      return t.concat(src);
    }
    if (typeof src === 'object') {
      const t = (target === undefined || target === null) ? {} : target;
      Object.keys(src).forEach(function (k) {
        t[k] = mergeInto(t[k], src[k]);
      });
      return t;
    }
    if (typeof src === 'number') {
      return (typeof target === 'number' ? target : 0) + src;
    }
    // string / boolean: keep first non-empty
    return (target === undefined || target === null || target === '') ? src : target;
  }

  rows.forEach(function (r) {
    mergeInto(merged, r);
  });
  return merged;
}

// Aggregate budget rows by scope:
//   scope='dept'    -> all rows of one department (across every project)
//   scope='project' -> all rows of one project (across every department)
//   scope='all'     -> every row (super admin)
function getBudgetSummary(scope, department, project) {
  const sheet = getDatabaseSheet();
  const rows = sheet.getDataRange().getValues();
  const matches = [];
  const entries = []; // per-row breakdown so the frontend can render one column per division (FAT) or per project (dept view)
  const deptStr = department ? String(department).trim().toLowerCase() : '';
  const projStr = project ? String(project).trim().toLowerCase() : '';

  for (let i = 1; i < rows.length; i++) {
    const rowDept = String(rows[i][4] || '').trim().toLowerCase();
    const rowProj = String(rows[i][1] || '');
    const rowComp = String(rows[i][0] || '');
    if (!rowComp && !rowProj) continue;

    let ok = false;
    if (scope === 'dept') {
      ok = (deptStr !== '') && rowDept === deptStr;
    } else if (scope === 'project') {
      ok = (projStr !== '') && rowProj.toLowerCase() === projStr;
    } else {
      ok = true;
    }
    if (!ok) continue;

    try {
      const parsed = JSON.parse(rows[i][3]);
      if (parsed && typeof parsed === 'object') {
        matches.push(parsed);
        entries.push({
          company: rows[i][0] || '',
          project: rows[i][1] || '',
          department: rows[i][4] || '',
          data: parsed
        });
      }
    } catch (err) {
      // skip corrupt row
    }
  }

  return {
    data: mergeBudgetData(matches),
    meta: { rows: matches.length, entries: entries }
  };
}

/**
 * Returns a direct XLSX export URL for the target spreadsheet.
 * The download will reflect the data already saved in the BudgetDatabase sheet.
 * Note: The caller's Google account must have access to the spreadsheet.
 */
function exportBudgetXlsx(company, project) {
  const data = getBudgetData(company, project, '');
  if (!data) {
    throw new Error('No saved budget data found for ' + company + ' / ' + project + '. Please save first.');
  }
  // Export directly from the target spreadsheet (no temporary file created)
  const exportUrl = 'https://docs.google.com/spreadsheets/d/' + TARGET_SPREADSHEET_ID + '/export?format=xlsx&id=' + TARGET_SPREADSHEET_ID;
  return exportUrl;
}

// CORS & HTTP JSON Response Helper
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
