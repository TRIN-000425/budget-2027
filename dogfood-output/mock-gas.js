// Faithful mock of gas/Code.js for drunk-grandma QA (BUDGET 2027)
// Ports the REAL action logic including its quirks (no auth on save/
// saveDepartment/deleteDepartment, dept-head role demotion, exact-match get).
// Run: node dogfood-output/mock-gas.js   (serves public/ at :8765, API at /exec)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const ROOT = path.join(__dirname, '..', 'public');

// ---------------- in-memory "sheets" ----------------
let budgetRows = []; // [Company, Project, LastUpdated, BudgetDataJSON, Division]
let empRows = [];    // [EmployeeID, EmployeeName, AllowedProjects, AllowedCompanies, Role, CreatedAt, Division]
let deptRows = [];   // [Division, AllowedModules, AllowedProjects, AllowedCompanies, CreatedAt]
let logRows = [];

const now = new Date();
const iso = now.toISOString();

// ---- Divisions: 17 defaults, MARKETING scoped to modules+projects ----
const DEFAULT_DIVISIONS = ["BOD","COLL","COO","CORFIN","CORSEC","FAT","GCR","HC&GA","IT","LEGAL","MARKETING","PAYROLL","PROC","PROJECT","QS","SALES","TECHPLAN"];
DEFAULT_DIVISIONS.forEach(d => deptRows.push([d, "ALL", "ALL", "ALL", iso]));
// Scope MARKETING: modules target-revenue, marketing-activity, corp-event ; projects Marcs Boulevard + Collins Boulevard
const mkt = deptRows.find(r => r[0] === 'MARKETING');
mkt[1] = "target-revenue,marketing-activity,corp-event";
mkt[2] = "Marcs Boulevard,Collins Boulevard";
mkt[3] = "PT Puri Triniti Batam,PT Triniti Menara Gading,PT Triniti Menara Serpong";
// Scope SALES: only target-revenue + sales-cost modules, ALL projects
const sales = deptRows.find(r => r[0] === 'SALES');
sales[1] = "target-revenue,sales-cost";

// ---- Employees ----
function emp(id, name, projects, companies, role, division) {
  return [id, name, projects, companies, role, iso, division];
}
empRows = [
  emp('1001', 'Administrator', 'ALL', 'ALL', 'Admin', ''),
  emp('2001', 'Sari Sales Head', 'ALL', 'ALL', 'DeptHead', 'SALES'),
  emp('2002', 'Budi Staff Sales', 'Marcs Boulevard,Collins Boulevard', 'PT Puri Triniti Batam,PT Triniti Menara Serpong', 'User', 'SALES'),
  emp('2003', 'Tini Viewer Sales', 'Marcs Boulevard', 'PT Puri Triniti Batam', 'Viewer', 'SALES'),
  emp('2004', 'Maya Mkt Head', 'ALL', 'ALL', 'DeptHead', 'MARKETING'),
  emp('2005', 'Dodi User Mkt', 'Marcs Boulevard', 'PT Puri Triniti Batam', 'User', 'MARKETING'),
  emp('3001', 'Fatma FAT Manager', 'Marcs Boulevard', 'PT Puri Triniti Batam', 'FAT', 'FAT'),
  emp('2006', 'Citra CORFIN User', 'Head Office', 'PT Perintis Triniti Properti Tbk', 'User', 'CORFIN'),
  emp('2007', 'Rudi Other DeptHead', 'ALL', 'ALL', 'DeptHead', 'CORFIN'),
  emp('2008', 'Ivan IT Head', 'ALL', 'ALL', 'DeptHead', 'IT'),
  emp('2009', 'Lia Legal Head', 'ALL', 'ALL', 'DeptHead', 'LEGAL')
];

// ---- Budget data builder (mirrors frontend getInitialDataStructure) ----
function initData() {
  return {
    target_revenue: [
      { category: 'Apartment Type A', stock_units: 15, stock_sqm: 600, price_sqm: 18000000, units: Array(12).fill(0), sqm: Array(12).fill(0) },
      { category: 'Apartment Type B', stock_units: 10, stock_sqm: 500, price_sqm: 20000000, units: Array(12).fill(0), sqm: Array(12).fill(0) },
      { category: 'Ruko / Shophouse', stock_units: 5, stock_sqm: 750, price_sqm: 25000000, units: Array(12).fill(0), sqm: Array(12).fill(0) }
    ],
    sales_cost: {
      inhouse: { closing_fee: Array(12).fill(0), or: Array(12).fill(0), komisi: Array(12).fill(0), reward: Array(12).fill(0), _rowLabels: { closing_fee: 'Closing Fee', or: 'OR (Overriding)', komisi: 'Komisi (Commission)', reward: 'Reward Sales' } },
      agent: { closing_fee: Array(12).fill(0), or: Array(12).fill(0), komisi: Array(12).fill(0), reward: Array(12).fill(0), _rowLabels: { closing_fee: 'Closing Fee', or: 'OR (Overriding)', komisi: 'Komisi (Commission)', reward: 'Reward Sales' } }
    },
    program_sales: {
      booking_fee_subsidy: Array(12).fill(0), dp_subsidy: Array(12).fill(0), angsuran_subsidy: Array(12).fill(0),
      akad_subsidy: Array(12).fill(0), rentback: Array(12).fill(0), cashback_patungan: Array(12).fill(0),
      _rowLabels: { booking_fee_subsidy: 'SUBSIDI BOOKING FEE', dp_subsidy: 'SUBSIDI DOWN PAYMENT', angsuran_subsidy: 'SUBSIDI ANGSURAN', akad_subsidy: 'SUBSIDI AKAD', rentback: 'RENTBACK (Investment fees)', cashback_patungan: 'CASHBACK PATUNGAN RUMAH' }
    },
    marketing_activity: {}, payroll_expenses: {}, dev_land: {}, ga_expenses: {},
    others_expenses: {}, finance_expenses: {}, tax_expenses: {}, corp_events: {},
    fixed_assets: [], business_trip: [], summary_2026: {}
  };
}

function seedBudget(company, project, division) {
  const d = initData();
  // Target revenue: 2 units in Jan..Mar of Type A at 18jt/sqm x 100sqm/mo
  d.target_revenue[0].units = [2, 3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  d.target_revenue[0].sqm = [100, 150, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  d.target_revenue[1].sqm = [50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  d.sales_cost.inhouse.komisi = [50000000, 75000000, 50000000, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  d.sales_cost.agent.komisi = [60000000, 90000000, 60000000, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  d.program_sales.booking_fee_subsidy = [10000000, 10000000, 10000000, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  d.ga_expenses['62210001'] = [5000000, 5000000, 5000000, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  d.payroll_expenses['5.1.01.01'] = [150000000, 150000000, 150000000, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  d.fixed_assets = [
    { id: 'fa_seed1', category: 'IT Hardware & Software', desc: 'Laptop', division: division || 'SALES', justification: 'Must To Have', new_replace: 'New', qty: 2, price: 18000000, month: 2 },
    { id: 'fa_seed2', category: 'Peralatan Kantor', desc: 'Printer', division: division || 'SALES', justification: 'Nice To Have', new_replace: 'New', qty: 1, price: 5000000, month: 4 }
  ];
  d.business_trip = [
    { id: 'trip_seed1', employee: 'Budi', grade: 'Staff', destination: 'Local', city: 'Bandung', division: division || 'SALES', duration: 3, month: 2, ticket_price: 4000000 }
  ];
  return d;
}

// ---- Seed budget rows ----
budgetRows.push(['PT Puri Triniti Batam', 'Marcs Boulevard', iso, JSON.stringify(seedBudget('PT Puri Triniti Batam', 'Marcs Boulevard', 'SALES')), 'SALES']);
const mktData = initData();
// Marketing values on KEPT rows only (Placement/distribution set — Production set was
// removed as template doubles): 82 = Out-of-Home placement, 87 = POS placement
mktData.marketing_activity[82] = [20000000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
mktData.marketing_activity[87] = [15000000, 15000000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
mktData.corp_events['ce_seed'] = { qty: 1, price_unit: 50000000, monthly: [0, 50000000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
budgetRows.push(['PT Puri Triniti Batam', 'Marcs Boulevard', iso, JSON.stringify(mktData), 'MARKETING']);
const collins = seedBudget('PT Triniti Menara Serpong', 'Collins Boulevard', 'SALES');
collins.target_revenue[0].units = [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
collins.target_revenue[0].sqm = [80, 80, 80, 0, 0, 0, 0, 0, 0, 0, 0, 0];
budgetRows.push(['PT Triniti Menara Serpong', 'Collins Boulevard', iso, JSON.stringify(collins), 'SALES']);
// Legacy row with NO division (migration fallback test)
const legacy = seedBudget('JO Triniti Sentul', 'Sequoia Hills', '');
legacy.target_revenue[0].units = [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
legacy.target_revenue[0].sqm = [200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
budgetRows.push(['JO Triniti Sentul', 'Sequoia Hills', iso, JSON.stringify(legacy), '']);
// CORFIN Head Office row
const corfin = initData();
corfin.ga_expenses['62210001'] = [10000000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
corfin.finance_expenses['72110001'] = [80000000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
corfin.business_trip = [{ id: 'trip_corfin', employee: 'Citra', grade: 'Manager', destination: 'Overseas', city: 'Singapore', division: 'CORFIN', duration: 5, month: 3, ticket_price: 8000000 }];
budgetRows.push(['PT Perintis Triniti Properti Tbk', 'Head Office', iso, JSON.stringify(corfin), 'CORFIN']);

// ---- Extra divisions & projects (real COA codes so module tabs render too) ----
// Back-office style budget: payroll + GA + others + tax + trip + capex, no revenue.
function seedOpBudget(company, project, division, scale) {
  const d = initData();
  const s = scale || 1;
  d.payroll_expenses['62110001'] = [Math.round(150000000 * s), Math.round(150000000 * s), Math.round(150000000 * s), 0, 0, 0, 0, 0, 0, 0, 0, 0];
  d.ga_expenses['62210001'] = [Math.round(5000000 * s), Math.round(5000000 * s), Math.round(5000000 * s), 0, 0, 0, 0, 0, 0, 0, 0, 0];
  d.others_expenses['71110001'] = [Math.round(3000000 * s), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  d.tax_expenses['62290001'] = [Math.round(2500000 * s), Math.round(2500000 * s), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  d.finance_expenses['72110001'] = [Math.round(2000000 * s), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  d.fixed_assets = [
    { id: 'fa_' + division + '_1', category: 'IT Hardware & Software', desc: 'Laptop', division: division, justification: 'Must To Have', new_replace: 'New', qty: Math.max(1, Math.round(2 * s)), price: 18000000, month: 3 },
    { id: 'fa_' + division + '_2', category: 'Peralatan Kantor', desc: 'Printer', division: division, justification: 'Nice To Have', new_replace: 'New', qty: 1, price: 5000000, month: 5 }
  ];
  d.business_trip = [
    { id: 'trip_' + division, employee: division + ' Staff', grade: 'Staff', destination: 'Local', city: 'Jakarta', division: division, duration: 2, month: 4, ticket_price: 2500000 }
  ];
  return d;
}
const pushOp = (company, project, division, scale) =>
  budgetRows.push([company, project, iso, JSON.stringify(seedOpBudget(company, project, division, scale)), division]);

// Marcs Boulevard (PT Puri Triniti Batam): SALES + MARKETING + IT + PROC + QS
pushOp('PT Puri Triniti Batam', 'Marcs Boulevard', 'IT', 1.0);
pushOp('PT Puri Triniti Batam', 'Marcs Boulevard', 'PROC', 0.6);
pushOp('PT Puri Triniti Batam', 'Marcs Boulevard', 'QS', 0.7);
// Collins Boulevard (PT Triniti Menara Serpong): SALES + LEGAL + HC&GA
pushOp('PT Triniti Menara Serpong', 'Collins Boulevard', 'LEGAL', 0.8);
pushOp('PT Triniti Menara Serpong', 'Collins Boulevard', 'HC&GA', 0.9);
// Sequoia Hills (PT Triniti Menara Gading): SALES + legacy(no dept)
const seqSales = seedBudget('PT Triniti Menara Gading', 'Sequoia Hills', 'SALES');
seqSales.target_revenue[0].units = [2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
seqSales.target_revenue[0].sqm = [120, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
budgetRows.push(['PT Triniti Menara Gading', 'Sequoia Hills', iso, JSON.stringify(seqSales), 'SALES']);
// District East (PT Triniti Menara Gading): COO + CORSEC + GCR + TECHPLAN
pushOp('PT Triniti Menara Gading', 'District East', 'COO', 1.5);
pushOp('PT Triniti Menara Gading', 'District East', 'CORSEC', 0.5);
pushOp('PT Triniti Menara Gading', 'District East', 'GCR', 0.4);
pushOp('PT Triniti Menara Gading', 'District East', 'TECHPLAN', 0.6);
// Holdwell Business Park (PT Triniti Menara Gading): COLL + FAT + PAYROLL + PROJECT
pushOp('PT Triniti Menara Gading', 'Holdwell Business Park', 'COLL', 0.8);
pushOp('PT Triniti Menara Gading', 'Holdwell Business Park', 'FAT', 1.0);
pushOp('PT Triniti Menara Gading', 'Holdwell Business Park', 'PAYROLL', 0.5);
pushOp('PT Triniti Menara Gading', 'Holdwell Business Park', 'PROJECT', 0.7);
// SW & TS (PT Triniti Menara Serpong): BOD
pushOp('PT Triniti Menara Serpong', 'SW & TS', 'BOD', 2.0);

// ---------------- faithful ports of Code.js logic ----------------
function verifyNikLogin(nik) {
  if (!nik) return null;
  const searchNik = String(nik).trim().toLowerCase();
  for (let i = 0; i < empRows.length; i++) {
    if (String(empRows[i][0]).trim().toLowerCase() === searchNik) {
      const department = String(empRows[i][6] || '').trim();
      const deptAccess = getDepartmentByName(department);
      return {
        employeeId: String(empRows[i][0]),
        name: empRows[i][1] || 'Employee',
        allowedProjects: String(empRows[i][2] || 'ALL'),
        allowedCompanies: String(empRows[i][3] || 'ALL'),
        role: empRows[i][4] || 'User',
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
  const search = String(department).trim().toLowerCase();
  for (let i = 0; i < deptRows.length; i++) {
    if (String(deptRows[i][0] || '').trim().toLowerCase() === search) {
      return {
        department: String(deptRows[i][0]),
        allowedModules: String(deptRows[i][1] || 'ALL'),
        allowedProjects: String(deptRows[i][2] || 'ALL'),
        allowedCompanies: String(deptRows[i][3] || 'ALL'),
        createdAt: deptRows[i][4]
      };
    }
  }
  return null;
}

function getBudgetData(company, project, department) {
  const deptStr = department ? String(department).trim().toLowerCase() : '';
  for (let i = 0; i < budgetRows.length; i++) {
    if (budgetRows[i][0] === company && budgetRows[i][1] === project && String(budgetRows[i][4] || '').trim().toLowerCase() === deptStr) {
      try { return JSON.parse(budgetRows[i][3]); } catch (e) { return null; }
    }
  }
  if (deptStr) {
    for (let i = 0; i < budgetRows.length; i++) {
      if (budgetRows[i][0] === company && budgetRows[i][1] === project && !String(budgetRows[i][4] || '').trim()) {
        try { return JSON.parse(budgetRows[i][3]); } catch (e) { return null; }
      }
    }
  }
  return null;
}

function saveBudgetData(company, project, department, budgetData) {
  const dataString = JSON.stringify(budgetData);
  const timestamp = new Date();
  const deptStr = department ? String(department).trim() : '';
  for (let i = 0; i < budgetRows.length; i++) {
    if (budgetRows[i][0] === company && budgetRows[i][1] === project && String(budgetRows[i][4] || '').trim() === deptStr) {
      budgetRows[i][2] = timestamp;
      budgetRows[i][3] = dataString;
      return;
    }
  }
  budgetRows.push([company, project, timestamp, dataString, deptStr]);
}

function addEmployeeID(employeeId, name, allowedProjects, allowedCompanies, role, department, callerNik) {
  if (callerNik) {
    const caller = verifyNikLogin(callerNik);
    if (caller) {
      if (caller.role === 'DeptHead') {
        department = caller.department || '';
        if (role === 'Admin' || role === 'DeptHead' || role === 'FAT') role = 'User';
      }
    }
  }
  const projStr = Array.isArray(allowedProjects) ? allowedProjects.join(',') : (allowedProjects || 'ALL');
  const compStr = Array.isArray(allowedCompanies) ? allowedCompanies.join(',') : (allowedCompanies || 'ALL');
  for (let i = 0; i < empRows.length; i++) {
    if (String(empRows[i][0]).trim() === String(employeeId).trim()) {
      const existingRole = empRows[i][4] || 'User';
      if (existingRole === 'Admin' && callerNik) {
        const caller = verifyNikLogin(callerNik);
        if (!caller || caller.role !== 'Admin') throw new Error('Unauthorized to modify Admin permissions');
      }
      if ((existingRole === 'Admin' || existingRole === 'DeptHead' || existingRole === 'FAT') && callerNik) {
        const caller = verifyNikLogin(callerNik);
        if (caller && caller.role === 'DeptHead') throw new Error('Unauthorized to modify privileged accounts');
      }
      empRows[i][1] = name || 'Employee';
      empRows[i][2] = projStr;
      empRows[i][3] = compStr;
      empRows[i][4] = role || 'User';
      if (department !== undefined) empRows[i][6] = department;
      logRows.push([new Date(), 'System', 'System', 'UpdateEmployeeID', employeeId + ' (' + name + ') Div: ' + (department || '-')]);
      return;
    }
  }
  empRows.push([employeeId, name || 'Employee', projStr, compStr, role || 'User', new Date(), department || '']);
  logRows.push([new Date(), 'System', 'System', 'AddEmployeeID', employeeId + ' (' + name + ') Div: ' + (department || '-')]);
}

function deleteEmployeeID(employeeId, callerNik) {
  if (callerNik) {
    const caller = verifyNikLogin(callerNik);
    if (caller && caller.role === 'DeptHead' && String(caller.employeeId).trim() === String(employeeId).trim()) {
      throw new Error('Dept Heads cannot delete their own account');
    }
  }
  for (let i = 0; i < empRows.length; i++) {
    if (String(empRows[i][0]).trim() === String(employeeId).trim()) {
      const existingRole = empRows[i][4] || 'User';
      if (existingRole === 'Admin' && callerNik) {
        const caller = verifyNikLogin(callerNik);
        if (!caller || caller.role !== 'Admin') throw new Error('Unauthorized to delete Admin user');
      }
      if (callerNik) {
        const caller = verifyNikLogin(callerNik);
        if (caller && caller.role === 'DeptHead') {
          const targetDept = String(empRows[i][6] || '').trim().toLowerCase();
          const callerDept = String(caller.department || '').trim().toLowerCase();
          if (targetDept !== callerDept) throw new Error('Unauthorized to delete users outside your division');
        }
      }
      empRows.splice(i, 1);
      logRows.push([new Date(), 'System', 'System', 'DeleteEmployeeID', employeeId]);
      return;
    }
  }
}

function listEmployeeIDs(deptFilter) {
  const filter = deptFilter ? String(deptFilter).trim().toLowerCase() : '';
  return empRows.filter(r => r[0] && (!filter || String(r[6] || '').trim().toLowerCase() === filter))
    .map(r => ({
      employeeId: String(r[0]), name: r[1] || 'Employee',
      allowedProjects: String(r[2] || 'ALL'), allowedCompanies: String(r[3] || 'ALL'),
      role: r[4] || 'User', createdAt: r[5], department: String(r[6] || '').trim()
    }));
}

function listDepartments() {
  return deptRows.filter(r => r[0]).map(r => ({
    department: String(r[0]), allowedModules: String(r[1] || 'ALL'),
    allowedProjects: String(r[2] || 'ALL'), allowedCompanies: String(r[3] || 'ALL'), createdAt: r[4]
  }));
}

function saveDepartment(department, allowedModules, allowedProjects, allowedCompanies) {
  const modStr = Array.isArray(allowedModules) ? allowedModules.join(',') : (allowedModules || 'ALL');
  const projStr = Array.isArray(allowedProjects) ? allowedProjects.join(',') : (allowedProjects || 'ALL');
  const compStr = Array.isArray(allowedCompanies) ? allowedCompanies.join(',') : (allowedCompanies || 'ALL');
  for (let i = 0; i < deptRows.length; i++) {
    if (String(deptRows[i][0]).trim().toLowerCase() === String(department).trim().toLowerCase()) {
      deptRows[i][1] = modStr; deptRows[i][2] = projStr; deptRows[i][3] = compStr;
      logRows.push([new Date(), 'System', 'System', 'UpdateDivision', department + ' | Modules: ' + modStr]);
      return;
    }
  }
  deptRows.push([department, modStr, projStr, compStr, new Date()]);
  logRows.push([new Date(), 'System', 'System', 'AddDivision', department + ' | Modules: ' + modStr]);
}

function deleteDepartment(department) {
  for (let i = 0; i < deptRows.length; i++) {
    if (String(deptRows[i][0]).trim().toLowerCase() === String(department).trim().toLowerCase()) {
      deptRows.splice(i, 1);
      empRows.forEach(r => { if (String(r[6] || '').trim().toLowerCase() === String(department).trim().toLowerCase()) r[6] = ''; });
      logRows.push([new Date(), 'System', 'System', 'DeleteDivision', department]);
      return;
    }
  }
}

// mergeBudgetData — exact port
function mergeBudgetData(rows) {
  const merged = {};
  function mergeInto(target, src) {
    if (src === null || src === undefined) return target;
    if (Array.isArray(src)) {
      const t = (target === undefined || target === null) ? [] : target;
      if (src.every(function (x) { return typeof x === 'number'; })) {
        for (let i = 0; i < src.length; i++) t[i] = (t[i] || 0) + src[i];
        return t;
      }
      return t.concat(src);
    }
    if (typeof src === 'object') {
      const t = (target === undefined || target === null) ? {} : target;
      Object.keys(src).forEach(function (k) { t[k] = mergeInto(t[k], src[k]); });
      return t;
    }
    if (typeof src === 'number') return (typeof target === 'number' ? target : 0) + src;
    return (target === undefined || target === null || target === '') ? src : target;
  }
  rows.forEach(function (r) { mergeInto(merged, r); });
  return merged;
}

function getBudgetSummary(scope, department, project) {
  const deptStr = department ? String(department).trim().toLowerCase() : '';
  const projStr = project ? String(project).trim().toLowerCase() : '';
  const matches = [];
  const entries = [];
  for (let i = 0; i < budgetRows.length; i++) {
    const rowDept = String(budgetRows[i][4] || '').trim().toLowerCase();
    const rowProj = String(budgetRows[i][1] || '');
    const rowComp = String(budgetRows[i][0] || '');
    if (!rowComp && !rowProj) continue;
    let ok = false;
    if (scope === 'dept') ok = (deptStr !== '') && rowDept === deptStr;
    else if (scope === 'project') ok = (projStr !== '') && rowProj.toLowerCase() === projStr;
    else ok = true;
    if (!ok) continue;
    try {
      const parsed = JSON.parse(budgetRows[i][3]);
      if (parsed && typeof parsed === 'object') {
        matches.push(parsed);
        entries.push({ company: budgetRows[i][0] || '', project: budgetRows[i][1] || '', department: budgetRows[i][4] || '', data: parsed });
      }
    } catch (e) {}
  }
  return { data: mergeBudgetData(matches), meta: { rows: matches.length, entries: entries } };
}

// ---------------- HTTP server ----------------
function sendJson(res, obj) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // API endpoint (frontend POSTs to gasUrl root, GETs with ?action=)
  if (url.pathname === '/exec' || url.pathname === '/') {
    const e = { parameter: Object.fromEntries(url.searchParams) };
    if (req.method === 'GET' && e.parameter.action) {
      const action = e.parameter.action;
      try {
        if (action === 'get') return sendJson(res, { status: 'success', data: getBudgetData(e.parameter.company, e.parameter.project, e.parameter.department || '') });
        if (action === 'loginNik') {
          const user = verifyNikLogin(e.parameter.nik);
          return sendJson(res, user ? { status: 'success', user } : { status: 'error', message: 'NIK not found or unauthorized' });
        }
        if (action === 'listEmployees') return sendJson(res, { status: 'success', data: listEmployeeIDs(e.parameter.department || '') });
        if (action === 'listDepartments') return sendJson(res, { status: 'success', data: listDepartments() });
        if (action === 'summary') {
          const result = getBudgetSummary(e.parameter.scope || 'all', e.parameter.department || '', e.parameter.project || '');
          return sendJson(res, { status: 'success', data: result.data, meta: result.meta });
        }
        if (action === 'export') {
          const data = getBudgetData(e.parameter.company, e.parameter.project, '');
          if (!data) return sendJson(res, { status: 'error', message: 'No saved budget data found for ' + e.parameter.company + ' / ' + e.parameter.project + '. Please save first.' });
          return sendJson(res, { status: 'success', exportUrl: 'https://docs.google.com/spreadsheets/d/X/export?format=xlsx' });
        }
        return sendJson(res, { status: 'error', message: 'Invalid action specified' });
      } catch (err) {
        return sendJson(res, { status: 'error', message: err.toString() });
      }
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const action = payload.action;
          try {
            if (action === 'save') {
              const caller = payload.callerNik ? verifyNikLogin(payload.callerNik) : null;
              if (!caller) return sendJson(res, { status: 'error', message: 'Authentication required: callerNik is missing or invalid' });
              if (caller.role === 'Viewer' || caller.role === 'FAT') return sendJson(res, { status: 'error', message: 'Read-only role (' + caller.role + ') cannot save budget data' });
              if (caller.role !== 'Admin' && String(caller.department || '').trim().toLowerCase() !== String(payload.department || '').trim().toLowerCase()) return sendJson(res, { status: 'error', message: 'Not authorized to save budget for division ' + (payload.department || '(none)') });
              saveBudgetData(payload.company, payload.project, payload.department || '', payload.data);
              logRows.push([new Date(), payload.company, payload.project, 'SaveBudget', 'Budget updated by ' + (caller.employeeId || '?') + ' (Div: ' + (payload.department || '-') + ')']);
              return sendJson(res, { status: 'success', message: 'Budget committed successfully' });
            }
            if (action === 'addEmployee') {
              addEmployeeID(payload.employeeId, payload.name, payload.allowedProjects, payload.allowedCompanies, payload.role, payload.department || '', payload.callerNik);
              return sendJson(res, { status: 'success', message: 'Employee ID added' });
            }
            if (action === 'deleteEmployee') {
              deleteEmployeeID(payload.employeeId, payload.callerNik);
              return sendJson(res, { status: 'success', message: 'Employee ID deleted' });
            }
            if (action === 'saveDepartment') {
              const caller = payload.callerNik ? verifyNikLogin(payload.callerNik) : null;
              if (!caller || caller.role !== 'Admin') return sendJson(res, { status: 'error', message: 'Only Super Admin may modify division access' });
              saveDepartment(payload.department, payload.allowedModules, payload.allowedProjects, payload.allowedCompanies);
              return sendJson(res, { status: 'success', message: 'Division access saved' });
            }
            if (action === 'deleteDepartment') {
              const caller = payload.callerNik ? verifyNikLogin(payload.callerNik) : null;
              if (!caller || caller.role !== 'Admin') return sendJson(res, { status: 'error', message: 'Only Super Admin may delete divisions' });
              deleteDepartment(payload.department);
              return sendJson(res, { status: 'success', message: 'Division deleted' });
            }
            return sendJson(res, { status: 'error', message: 'Invalid action specified' });
          } catch (err) {
            return sendJson(res, { status: 'error', message: 'Failed to process request: ' + err.toString() });
          }
        } catch (err) {
          return sendJson(res, { status: 'error', message: 'Failed to process request: ' + err.toString() });
        }
      });
      return;
    }
    // GET without action (e.g. browser hitting root) → serve index.html
  }

  // Static files
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('Mock GAS + static server on http://127.0.0.1:' + PORT);
  console.log('Rows seeded: budgets=' + budgetRows.length + ' employees=' + empRows.length + ' divisions=' + deptRows.length);
});
