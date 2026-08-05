// Post-fix auth battery: every previously-open hole must now be rejected
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
  // 1) Viewer tries to save (was accepted before the fix)
  out.viewerSave = await post({ action: 'save', company: 'PT Puri Triniti Batam', project: 'Marcs Boulevard', department: 'SALES', callerNik: '2003', data: { target_revenue: [] } });
  // 2) User 2002 (SALES) tries to save into CORFIN's row (was accepted before)
  out.crossDeptSave = await post({ action: 'save', company: 'PT Puri Triniti Batam', project: 'Marcs Boulevard', department: 'CORFIN', callerNik: '2002', data: { target_revenue: [] } });
  // 3) Anonymous division delete (was accepted before)
  out.anonDeleteDept = await post({ action: 'deleteDepartment', department: 'TECHPLAN' });
  // 4) Anonymous rogue division create (was accepted before)
  out.anonRogueDept = await post({ action: 'saveDepartment', department: 'ROGUE', allowedModules: 'ALL', allowedProjects: 'ALL', allowedCompanies: 'ALL' });
  // 5) DeptHead 2004 deletes DeptHead 2007 in another division (was accepted before)
  out.crossDeptDelete = await post({ action: 'deleteEmployee', employeeId: '2007', callerNik: '2004' });
  // 6) DeptHead 2004 tries to update DeptHead 2001 (demotion attempt — was accepted before)
  out.demoteAttempt = await post({ action: 'addEmployee', employeeId: '2001', name: 'Sari Sales Head', allowedProjects: 'ALL', allowedCompanies: 'ALL', role: 'User', department: 'SALES', callerNik: '2004' });
  // 7) Legit: User 2002 saves into their OWN division — must still work
  out.legitSave = await post({ action: 'save', company: 'PT Puri Triniti Batam', project: 'Marcs Boulevard', department: 'SALES', callerNik: '2002', data: { target_revenue: [{ category: 'OK', stock_units: 1, stock_sqm: 1, price_sqm: 1, units: Array(12).fill(0), sqm: Array(12).fill(0) }] } });
  // 8) Legit: DeptHead 2001 creates a User in their own division — must still work
  out.legitAddEmp = await post({ action: 'addEmployee', employeeId: '2200', name: 'New Sales', allowedProjects: 'Marcs Boulevard', allowedCompanies: 'ALL', role: 'User', department: 'SALES', callerNik: '2001' });
  // 9) Legit: Admin deletes a division — must still work
  out.legitAdminDelete = await post({ action: 'deleteDepartment', department: 'COLL', callerNik: '1001' });
  // Verify final server state
  var list = await (await fetch('http://127.0.0.1:8765/exec?action=listEmployees')).json();
  out.empIds = list.data.map(function (e) { return e.employeeId; });
  out.role2001 = (list.data.find(function (e) { return e.employeeId === '2001'; }) || {}).role;
  out.role2007 = (list.data.find(function (e) { return e.employeeId === '2007'; }) || {}).role;
  var depts = await (await fetch('http://127.0.0.1:8765/exec?action=listDepartments')).json();
  out.depts = depts.data.map(function (d) { return d.department; });
  var sales = await (await fetch('http://127.0.0.1:8765/exec?action=get&company=PT%20Puri%20Triniti%20Batam&project=Marcs%20Boulevard&department=SALES')).json();
  out.salesFirstCat = sales.data ? (sales.data.target_revenue || []).map(function (r) { return r.category; })[0] : null;
  window.__x = out;
})();
