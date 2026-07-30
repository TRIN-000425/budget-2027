// Google Apps Script Backend for 2027 Project Planned Budget Planner
// Copy and paste this code in your Google Apps Script editor (Extensions -> Apps Script from your Google Sheet).
// Be sure to deploy this as a "Web App", executed as "Me", with access set to "Anyone".

const DATABASE_SHEET_NAME = "BudgetDatabase";
const EMPLOYEE_SHEET_NAME = "EmployeeIDs";
const LOG_SHEET_NAME       = "ChangeLog";
const TARGET_SPREADSHEET_ID = "1jK1AyCzoZzRZn_l-bNFwsV6Zz7dg7hSm2UY7u5sN0Xo";

/**
 * RUN THIS FUNCTION ONCE IN APPS SCRIPT EDITOR!
 * Automatically initializes and creates all required sheet tabs:
 * 1. BudgetDatabase (for saving JSON budget records)
 * 2. EmployeeIDs (for user NIK login & permissions)
 * 3. ChangeLog (for audit trail)
 */
function setupAllSheets() {
  const dbSheet = getDatabaseSheet();
  const empSheet = getEmployeeSheet();
  const logSheet = getLogSheet();
  
  Logger.log("Successfully created/verified all tabs:");
  Logger.log("- " + dbSheet.getName());
  Logger.log("- " + empSheet.getName() + " (Default Admin NIK: 1001)");
  Logger.log("- " + logSheet.getName());
}

function doGet(e) {
  const action = e.parameter.action;
  const company = e.parameter.company;
  const project = e.parameter.project;
  const nik = e.parameter.nik;
  
  if (action === 'get') {
      const data = getBudgetData(company, project);
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
      const ids = listEmployeeIDs();
      return createJsonResponse({ status: 'success', data: ids });
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
        const budgetData = payload.data;
        
        saveBudgetData(company, project, budgetData);
        logChange(company, project, "SaveBudget", "Budget updated by user");
        return createJsonResponse({ status: 'success', message: 'Budget committed successfully' });
    } else if (action === 'addEmployee') {
        const { employeeId, name, allowedProjects, allowedCompanies, role } = payload;
        addEmployeeID(employeeId, name, allowedProjects, allowedCompanies, role);
        return createJsonResponse({ status: 'success', message: 'Employee ID added' });
    } else if (action === 'deleteEmployee') {
        const { employeeId } = payload;
        deleteEmployeeID(employeeId);
        return createJsonResponse({ status: 'success', message: 'Employee ID deleted' });
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
    // Initialize headers
    sheet.appendRow(["Company", "Project", "LastUpdated", "BudgetDataJSON"]);
    // Freeze header row
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Get or create Employee IDs sheet with permissions schema
function getEmployeeSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(EMPLOYEE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(EMPLOYEE_SHEET_NAME);
    sheet.appendRow(["EmployeeID", "EmployeeName", "AllowedProjects", "AllowedCompanies", "Role", "CreatedAt"]);
    sheet.setFrozenRows(1);
    // Add default admin row
    sheet.appendRow(["1001", "Administrator", "ALL", "ALL", "Admin", new Date()]);
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

// NIK Login Verification
function verifyNikLogin(nik) {
  if (!nik) return null;
  const sheet = getEmployeeSheet();
  const rows = sheet.getDataRange().getValues();
  const searchNik = String(nik).trim().toLowerCase();
  
  for (let i = 1; i < rows.length; i++) {
    const rowNik = String(rows[i][0]).trim().toLowerCase();
    if (rowNik === searchNik) {
      return {
        employeeId: String(rows[i][0]),
        name: rows[i][1] || "Employee",
        allowedProjects: String(rows[i][2] || "ALL"),
        allowedCompanies: String(rows[i][3] || "ALL"),
        role: rows[i][4] || "User"
      };
    }
  }
  return null;
}

// Employee ID CRUD operations
function addEmployeeID(employeeId, name, allowedProjects, allowedCompanies, role) {
  const sheet = getEmployeeSheet();
  const timestamp = new Date();
  const projStr = Array.isArray(allowedProjects) ? allowedProjects.join(",") : (allowedProjects || "ALL");
  const compStr = Array.isArray(allowedCompanies) ? allowedCompanies.join(",") : (allowedCompanies || "ALL");
  
  // Check if exists to update
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(employeeId).trim()) {
      sheet.getRange(i + 1, 2).setValue(name || "Employee");
      sheet.getRange(i + 1, 3).setValue(projStr);
      sheet.getRange(i + 1, 4).setValue(compStr);
      sheet.getRange(i + 1, 5).setValue(role || "User");
      logChange("System", "System", "UpdateEmployeeID", employeeId + " (" + name + ")");
      return;
    }
  }
  
  sheet.appendRow([employeeId, name || "Employee", projStr, compStr, role || "User", timestamp]);
  logChange("System", "System", "AddEmployeeID", employeeId + " (" + name + ")");
}

function deleteEmployeeID(employeeId) {
  const sheet = getEmployeeSheet();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(employeeId).trim()) {
      sheet.deleteRow(i + 1);
      logChange("System", "System", "DeleteEmployeeID", employeeId);
      return;
    }
  }
}

function listEmployeeIDs() {
  const sheet = getEmployeeSheet();
  const rows = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) {
      list.push({
        employeeId: String(rows[i][0]),
        name: rows[i][1] || "Employee",
        allowedProjects: String(rows[i][2] || "ALL"),
        allowedCompanies: String(rows[i][3] || "ALL"),
        role: rows[i][4] || "User",
        createdAt: rows[i][5]
      });
    }
  }
  return list;
}

function getBudgetData(company, project) {
  const sheet = getDatabaseSheet();
  const rows = sheet.getDataRange().getValues();
  
  // Search rows (skipping header)
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === company && rows[i][1] === project) {
      try {
        return JSON.parse(rows[i][3]);
      } catch (err) {
        return null;
      }
    }
  }
  return null;
}

function saveBudgetData(company, project, budgetData) {
  const sheet = getDatabaseSheet();
  const rows = sheet.getDataRange().getValues();
  const dataString = JSON.stringify(budgetData);
  const timestamp = new Date();
  
  // Search if row exists to overwrite
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === company && rows[i][1] === project) {
      sheet.getRange(i + 1, 3).setValue(timestamp);
      sheet.getRange(i + 1, 4).setValue(dataString);
      return;
    }
  }
  
  // Create new row
  sheet.appendRow([company, project, timestamp, dataString]);
  return;
}

/**
 * Returns a direct XLSX export URL for the target spreadsheet.
 * The download will reflect the data already saved in the BudgetDatabase sheet.
 * Note: The caller's Google account must have access to the spreadsheet.
 */
function exportBudgetXlsx(company, project) {
  const data = getBudgetData(company, project);
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
