// FY 2027 Project Planned Budget Planner - Main JS Application
let state = {
    metadata: null,
    templates: null,
    selectedCompany: '',
    selectedProject: '',
    gasUrl: localStorage.getItem('gas_url') || 'https://script.google.com/macros/s/AKfycbxg0wEPqmGRFkoj-HDysUW6UV_HKzEZr1LrdgZ_8IBB9BgymAWEXFuvBzppls4Zpgk/exec',
    isDirty: false,
    currentUser: JSON.parse(sessionStorage.getItem('current_user') || 'null'),
    nikList: [],
    data: getInitialDataStructure()
};

// Months names and formatting helpers
const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const formatCurrency = (val) => {
    if (val === undefined || val === null || isNaN(val)) return 'Rp 0';
    return 'Rp ' + Math.round(val).toLocaleString('id-ID');
};

const formatShortCurrency = (val) => {
    if (val === undefined || val === null || isNaN(val) || val === 0) return 'Rp 0';
    if (Math.abs(val) >= 1000000000) {
        return 'Rp ' + (val / 1000000000).toFixed(2) + ' Bio';
    } else if (Math.abs(val) >= 1000000) {
        return 'Rp ' + (val / 1000000).toFixed(2) + ' M';
    } else {
        return 'Rp ' + Math.round(val).toLocaleString('id-ID');
    }
};

const formatPercent = (val) => {
    if (val === undefined || val === null || isNaN(val)) return '0.0%';
    return (val * 100).toFixed(1) + '%';
};

// Initial Data Structure generator (matches Excel templates)
function getInitialDataStructure() {
    return {
        target_revenue: [
            { category: 'Apartment Type A', stock_units: 15, stock_sqm: 600, price_sqm: 18000000, units: Array(12).fill(0), sqm: Array(12).fill(0) },
            { category: 'Apartment Type B', stock_units: 10, stock_sqm: 500, price_sqm: 20000000, units: Array(12).fill(0), sqm: Array(12).fill(0) },
            { category: 'Ruko / Shophouse', stock_units: 5, stock_sqm: 750, price_sqm: 25000000, units: Array(12).fill(0), sqm: Array(12).fill(0) }
        ],
        sales_cost: {
            inhouse: {
                closing_fee: Array(12).fill(0),
                or: Array(12).fill(0),
                komisi: Array(12).fill(0),
                reward: Array(12).fill(0),
                _rowLabels: {
                    closing_fee: 'Closing Fee',
                    or: 'OR (Overriding)',
                    komisi: 'Komisi (Commission)',
                    reward: 'Reward Sales'
                }
            },
            agent: {
                closing_fee: Array(12).fill(0),
                or: Array(12).fill(0),
                komisi: Array(12).fill(0),
                reward: Array(12).fill(0),
                _rowLabels: {
                    closing_fee: 'Closing Fee',
                    or: 'OR (Overriding)',
                    komisi: 'Komisi (Commission)',
                    reward: 'Reward Sales'
                }
            }
        },
        program_sales: {
            booking_fee_subsidy: Array(12).fill(0),
            dp_subsidy: Array(12).fill(0),
            angsuran_subsidy: Array(12).fill(0),
            akad_subsidy: Array(12).fill(0),
            rentback: Array(12).fill(0),
            cashback_patungan: Array(12).fill(0),
            _rowLabels: {
                booking_fee_subsidy: 'SUBSIDI BOOKING FEE',
                dp_subsidy: 'SUBSIDI DOWN PAYMENT',
                angsuran_subsidy: 'SUBSIDI ANGSURAN',
                akad_subsidy: 'SUBSIDI AKAD',
                rentback: 'RENTBACK (Investment fees)',
                cashback_patungan: 'CASHBACK PATUNGAN RUMAH'
            }
        },
        marketing_activity: {},
        payroll_expenses: {},
        dev_land: {},
        ga_expenses: {},
        others_expenses: {},
        finance_expenses: {},
        tax_expenses: {},
        corp_events: {},
        fixed_assets: [],
        business_trip: [],
        hc_program: [],
        summary_2026: {}
    };
}

function refreshIcons() {
    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

// Sidebar collapse / expand
function toggleSidebar(e) {
    e.stopPropagation();
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.toggle('collapsed');
    refreshIcons();
}

function expandSidebar(e) {
    e.stopPropagation();
    const sidebar = document.querySelector('.sidebar');
    if (sidebar.classList.contains('collapsed')) {
        sidebar.classList.remove('collapsed');
        refreshIcons();
    }
}

function collapseSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar.classList.contains('collapsed')) {
        sidebar.classList.add('collapsed');
        refreshIcons();
    }
}

// Theme toggle
function toggleTheme() {
    const body = document.body;
    body.classList.toggle('light');
    const isLight = body.classList.contains('light');
    localStorage.setItem('budget_theme', isLight ? 'light' : 'dark');
    const icon = document.getElementById('theme-icon');
    if (icon) {
        icon.setAttribute('data-lucide', isLight ? 'sun' : 'moon');
        refreshIcons();
    }
}

function initTheme() {
    const saved = localStorage.getItem('budget_theme');
    if (saved === 'light') {
        document.body.classList.add('light');
        const icon = document.getElementById('theme-icon');
        if (icon) icon.setAttribute('data-lucide', 'sun');
    }
}

// App Initialization
window.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    showToast('Initializing budget planner...', 'info');
    
    // Load metadata and templates
    try {
        const metaRes = await fetch('metadata.json');
        state.metadata = await metaRes.json();
        
        const tempRes = await fetch('templates.json');
        state.templates = await tempRes.json();
        
        initDropdowns();
        initDefaultDynamicData();
        setupEventListeners();
        refreshIcons();
        
        // Load initial mock or live data
        triggerDataLoad();
    } catch (err) {
        console.error("Initialization error:", err);
        showToast('Failed to load local templates or metadata configuration', 'error');
    }
});

// Setup metadata options in dropdown lists filtered by NIK authorization
function initDropdowns() {
    const projSel = document.getElementById('project-select');
    const compSel = document.getElementById('company-select');
    
    if (!state.currentUser) {
        showNikLoginModal();
        return;
    }
    
    // Filter projects based on user permissions
    let allowedProjs = state.metadata.projects;
    if (state.currentUser.allowedProjects && state.currentUser.allowedProjects !== 'ALL') {
        const userProjList = state.currentUser.allowedProjects.split(',').map(s => s.trim().toLowerCase());
        allowedProjs = state.metadata.projects.filter(p => userProjList.includes(p.toLowerCase()));
    }
    
    if (allowedProjs.length === 0) allowedProjs = state.metadata.projects; // fallback
    
    projSel.innerHTML = allowedProjs.map(p => `<option value="${p}">${p}</option>`).join('');
    state.selectedProject = projSel.value;
    
    // Populate company entities based on selected project
    updateCompanyDropdownForProject(state.selectedProject);
}

function updateCompanyDropdownForProject(projectName) {
    const compSel = document.getElementById('company-select');
    const mapping = state.metadata.projectCompanyMapping || {};
    
    let entities = mapping[projectName] || state.metadata.companies;
    
    // Filter by NIK allowed companies if restricted
    if (state.currentUser && state.currentUser.allowedCompanies && state.currentUser.allowedCompanies !== 'ALL') {
        const userCompList = state.currentUser.allowedCompanies.split(',').map(s => s.trim().toLowerCase());
        const filtered = entities.filter(c => userCompList.includes(c.toLowerCase()));
        if (filtered.length > 0) entities = filtered;
    }
    
    compSel.innerHTML = entities.map(c => `<option value="${c}">${c}</option>`).join('');
    state.selectedCompany = compSel.value;
}

// Initialize templates into structure
function initDefaultDynamicData() {
    // G&A template mapping
    state.templates.ga.forEach(item => {
        state.data.ga_expenses[item.code] = Array(12).fill(0);
    });
    
    // Tax mapping
    state.templates.tax.forEach(item => {
        state.data.tax_expenses[item.code] = Array(12).fill(0);
    });
    
    // Others mapping
    state.templates.others.forEach(item => {
        state.data.others_expenses[item.code] = Array(12).fill(0);
    });
    
    // Finance mapping
    state.templates.finance.forEach(item => {
        state.data.finance_expenses[item.code] = Array(12).fill(0);
    });
    
    // Payroll mapping
    state.templates.payroll.forEach(item => {
        state.data.payroll_expenses[item.code] = Array(12).fill(0);
    });
    
    // Dev & Land mapping
    state.templates.dev_land.forEach(item => {
        if (item.num && item.num.includes('.')) {
            state.data.dev_land[item.row] = {
                sqm: item.sqm,
                cost_sqm: item.cost_sqm,
                rab_spk: item.rab_spk,
                realisasi: item.realisasi,
                best_est: item.best_est,
                monthly: Array(12).fill(0)
            };
        }
    });
    
    // Marketing Activity mapping
    state.templates.marketing.forEach(item => {
        if (item.type === 'input') {
            state.data.marketing_activity[item.row] = Array(12).fill(0);
        }
    });

    // Corp Event mapping
    state.templates.corp_event.forEach(item => {
        if (item.type === 'input') {
            state.data.corp_events[item.row] = {
                qty: item.qty,
                price_unit: item.price_unit,
                monthly: Array(12).fill(0)
            };
        }
    });
}

// Setup core navigation and action triggers
function setupEventListeners() {
    // Project selector change updates company entities
    document.getElementById('project-select').addEventListener('change', (e) => {
        state.selectedProject = e.target.value;
        updateCompanyDropdownForProject(state.selectedProject);
        triggerDataLoad();
    });
    
    // Company selector change
    document.getElementById('company-select').addEventListener('change', (e) => {
        state.selectedCompany = e.target.value;
        triggerDataLoad();
    });
    
    // Navigation items
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const navItem = e.currentTarget;
            const tabId = navItem.getAttribute('data-tab');
            switchTab(tabId);
        });
    });

    // Card Subtabs
    document.querySelectorAll('.card-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const subtabBtn = e.currentTarget;
            const container = subtabBtn.closest('.premium-card');
            
            container.querySelectorAll('.card-tab').forEach(t => t.classList.remove('active'));
            container.querySelectorAll('.subtab-panel').forEach(p => p.classList.remove('active'));
            
            subtabBtn.classList.add('active');
            const targetPanel = subtabBtn.getAttribute('data-subtab');
            document.getElementById(targetPanel).classList.add('active');
        });
    });
    
    // Sync triggers
    document.getElementById('save-btn').addEventListener('click', triggerDataSave);
    
    // Dynamic lists additions
    document.getElementById('add-revenue-cat').addEventListener('click', addTargetRevenueRow);
    document.getElementById('add-hc-row').addEventListener('click', addHCProgramRow);
    document.getElementById('add-fa-row').addEventListener('click', addFixedAssetRow);
    document.getElementById('add-trip-row').addEventListener('click', addBusinessTripRow);
    
    // GAS config modal listeners
    document.getElementById('sync-status').addEventListener('click', showGasConfigModal);
    
    // Sidebar toggle
    document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
    document.getElementById('menu-toggle').addEventListener('click', expandSidebar);
    document.getElementById('sidebar-backdrop').addEventListener('click', collapseSidebar);
    // Auto-collapse when clicking main content area
    document.querySelector('.main-content').addEventListener('click', collapseSidebar);
    document.getElementById('close-gas-modal').addEventListener('click', hideGasConfigModal);
    document.getElementById('cancel-gas-btn').addEventListener('click', hideGasConfigModal);
    document.getElementById('save-gas-btn').addEventListener('click', saveGasConfigLink);

    // Export button
    document.getElementById('export-summary-btn').addEventListener('click', exportBudget);
    const expHeadBtn = document.getElementById('export-btn-header');
    if (expHeadBtn) expHeadBtn.addEventListener('click', exportBudget);
    
    // Theme toggle
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    
    // NIK Authentication form
    document.getElementById('nik-login-form').addEventListener('submit', handleNikLoginSubmit);
    document.getElementById('logout-btn').addEventListener('click', handleNikLogout);
    
    // NIK Management UI
    document.getElementById('add-nik-btn').addEventListener('click', showNikEditModal);
    document.getElementById('close-nik-edit-modal').addEventListener('click', hideNikEditModal);
    document.getElementById('cancel-nik-edit-btn').addEventListener('click', hideNikEditModal);
    document.getElementById('save-nik-edit-btn').addEventListener('click', saveNikPermissions);
}

// Navigation controller
function switchTab(tabId) {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    
    const activeNav = document.querySelector(`.sidebar-nav [data-tab="${tabId}"]`);
    if (activeNav) activeNav.classList.add('active');
    
    const activePanel = document.getElementById(`tab-${tabId}`);
    if (activePanel) {
        activePanel.classList.add('active');
        renderTabContent(tabId);
    }
}

// Renders the specific tab's inputs and tables
function renderTabContent(tabId) {
    switch (tabId) {
        case 'dashboard':
            renderDashboardOverview();
            break;
        case 'target-revenue':
            renderTargetRevenueTable();
            break;
        case 'sales-cost':
            renderSalesCostTables();
            break;
        case 'marketing-activity':
            renderMarketingActivityTables();
            break;
        case 'dev-land':
            renderDevLandTable();
            break;
        case 'employee-hc':
            renderPayrollTable();
            break;
        case 'hc-program-planner':
            renderHCProgramList();
            break;
        case 'ga-others':
            renderGAOthersTables();
            break;
        case 'corp-event':
            renderCorpEventTable();
            break;
        case 'fixed-assets':
            renderFixedAssetsTable();
            break;
        case 'business-trip':
            renderBusinessTripTable();
            break;
        case 'summary-budget':
            renderSummaryBudgetTable();
            break;
        case 'nik-management':
            renderNikManagementTable();
            break;
    }
    refreshIcons();
}

// Dashboard rendering and KPIs computations
function renderDashboardOverview() {
    const sums = getCalculatedSummary();
    
    // Update KPI UI
    document.getElementById('kpi-revenue').innerText = formatShortCurrency(sums.totalRevenueVal);
    document.getElementById('kpi-units-sold').innerText = `${sums.totalUnitsSold} Units Sold`;
    
    document.getElementById('kpi-total-cost').innerText = formatShortCurrency(sums.totalCostVal);
    document.getElementById('kpi-cost-ratio').innerText = formatPercent(sums.totalRevenueVal > 0 ? (sums.totalCostVal / sums.totalRevenueVal) : 0) + ' ratio to Revenue';
    
    document.getElementById('kpi-project-cost').innerText = formatShortCurrency(sums.projectCostVal);
    document.getElementById('kpi-project-cost-ratio').innerText = formatPercent(sums.totalCostVal > 0 ? (sums.projectCostVal / sums.totalCostVal) : 0) + ' of total cost';
    
    document.getElementById('kpi-capex').innerText = formatShortCurrency(sums.capexCostVal);
    document.getElementById('kpi-capex-count').innerText = `${(state.data.fixed_assets || []).length} items requested`;
    
    // Draw chart bars
    const breakdown = [
        { name: 'Project Cost', val: sums.projectCostVal, color: 'purple' },
        { name: 'Sales & Marketing', val: sums.salesMarketingCostVal, color: 'emerald' },
        { name: 'Employee & HC', val: sums.employeeCostVal, color: 'indigo' },
        { name: 'G&A, Taxes & Loan', val: sums.operatingCostVal, color: 'amber' },
        { name: 'Fixed Assets', val: sums.capexCostVal, color: 'cherry' }
    ];
    
    const maxVal = Math.max(...breakdown.map(b => b.val), 0);
    
    const barsContainer = document.getElementById('module-breakdown-bars');
    if (!barsContainer) return;

    barsContainer.innerHTML = breakdown.map(item => {
        const pct = maxVal > 0 ? Math.min(100, Math.max(3, (item.val / maxVal) * 100)) : 0;
        return `
            <div class="chart-bar-row">
                <span class="label">${item.name}</span>
                <div class="bar-wrapper">
                    <div class="bar-fill ${item.color}" style="width: ${pct}%"></div>
                </div>
                <span class="val">${formatShortCurrency(item.val)}</span>
            </div>
        `;
    }).join('');
}

// 1. MODULE RENDER: TARGET MARKETING REVENUE
function renderTargetRevenueTable() {
    const table = document.getElementById('target-revenue-table');
    
    let html = `
        <thead>
            <tr>
                <th>Category</th>
                <th>Stock</th>
                <th>Price / sqm (Rp)</th>
                <th>Metric</th>
                <th>Total 2027</th>
                ${months.map(m => `<th>${m}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
    `;
    
    // Totals trackers
    let monthlyUnitsTotal = Array(12).fill(0);
    let monthlySqmTotal = Array(12).fill(0);
    let monthlyValueTotal = Array(12).fill(0);
    
    let stockUnitsTotal = 0;
    let stockSqmTotal = 0;
    
    state.data.target_revenue.forEach((row, rIdx) => {
        const unitsSum = row.units.reduce((a, b) => a + b, 0);
        const sqmSum = row.sqm.reduce((a, b) => a + b, 0);
        
        stockUnitsTotal += row.stock_units;
        stockSqmTotal += row.stock_sqm;
        
        // Dynamic row-by-row rendering
        // Section: Units
        html += `
            <tr class="row-group-header">
                <td colspan="16">
                    <span class="cat-name">${row.category}</span>
                    <span class="cat-actions">
                        <button class="btn-icon-xs" onclick="editTargetRevenueCategory(${rIdx})" title="Edit Category Name"><i data-lucide="pencil" class="icon-xs"></i></button>
                        <button class="btn-icon-xs btn-icon-danger" onclick="deleteTargetRevenueCategory(${rIdx})" title="Delete Category"><i data-lucide="trash-2" class="icon-xs"></i></button>
                    </span>
                </td>
            </tr>
            <tr>
                <td>└─ Unit Target</td>
                <td><input type="number" class="table-input" value="${row.stock_units}" onchange="updateTargetRevenue(${rIdx}, 'stock_units', null, this.value)"></td>
                <td></td>
                <td>Units</td>
                <td><input type="text" class="table-input readonly" readonly value="${unitsSum}"></td>
                ${row.units.map((u, mIdx) => {
                    monthlyUnitsTotal[mIdx] += u;
                    return `<td><input type="number" class="table-input" value="${u}" onchange="updateTargetRevenue(${rIdx}, 'units', ${mIdx}, this.value)"></td>`;
                }).join('')}
            </tr>
            <tr>
                <td>└─ Sqm Target</td>
                <td><input type="number" class="table-input" value="${row.stock_sqm}" onchange="updateTargetRevenue(${rIdx}, 'stock_sqm', null, this.value)"></td>
                <td><input type="number" class="table-input" value="${row.price_sqm}" onchange="updateTargetRevenue(${rIdx}, 'price_sqm', null, this.value)"></td>
                <td>Sqm</td>
                <td><input type="text" class="table-input readonly" readonly value="${sqmSum.toLocaleString('id-ID')}"></td>
                ${row.sqm.map((s, mIdx) => {
                    monthlySqmTotal[mIdx] += s;
                    return `<td><input type="number" class="table-input" value="${s}" onchange="updateTargetRevenue(${rIdx}, 'sqm', ${mIdx}, this.value)"></td>`;
                }).join('')}
            </tr>
            <tr>
                <td>└─ Sales Value (Rp)</td>
                <td></td>
                <td></td>
                <td>Value</td>
                <td><input type="text" class="table-input readonly" readonly value="${(sqmSum * row.price_sqm).toLocaleString('id-ID')}"></td>
                ${row.sqm.map((s, mIdx) => {
                    const rowVal = s * row.price_sqm;
                    monthlyValueTotal[mIdx] += rowVal;
                    return `<td><input type="text" class="table-input readonly" readonly value="${rowVal.toLocaleString('id-ID')}"></td>`;
                }).join('')}
            </tr>
        `;
    });
    
    // Grand totals row
    const unitsGrandSum = monthlyUnitsTotal.reduce((a, b) => a + b, 0);
    const sqmGrandSum = monthlySqmTotal.reduce((a, b) => a + b, 0);
    const valueGrandSum = monthlyValueTotal.reduce((a, b) => a + b, 0);
    
    // YTD cumulative arrays
    const unitsYTD = [];
    const sqmYTD = [];
    const valueYTD = [];
    for (let m = 0; m < 12; m++) {
        unitsYTD[m] = (unitsYTD[m-1] || 0) + monthlyUnitsTotal[m];
        sqmYTD[m] = (sqmYTD[m-1] || 0) + monthlySqmTotal[m];
        valueYTD[m] = (valueYTD[m-1] || 0) + monthlyValueTotal[m];
    }

    html += `
        <tr class="row-grand-total">
            <td>TOTAL UNITS TARGET</td>
            <td>${stockUnitsTotal}</td>
            <td></td>
            <td>Units</td>
            <td>${unitsGrandSum}</td>
            ${monthlyUnitsTotal.map(u => `<td>${u}</td>`).join('')}
        </tr>
        <tr class="row-grand-total">
            <td>TOTAL SQM TARGET</td>
            <td>${stockSqmTotal.toLocaleString('id-ID')}</td>
            <td></td>
            <td>Sqm</td>
            <td>${sqmGrandSum.toLocaleString('id-ID')}</td>
            ${monthlySqmTotal.map(s => `<td>${s.toLocaleString('id-ID')}</td>`).join('')}
        </tr>
        <tr class="row-grand-total">
            <td>TOTAL SALES VALUE</td>
            <td></td>
            <td></td>
            <td>Rupiah</td>
            <td>${valueGrandSum.toLocaleString('id-ID')}</td>
            ${monthlyValueTotal.map(v => `<td>${v.toLocaleString('id-ID')}</td>`).join('')}
        </tr>
        <tr class="row-ytd">
            <td>UNITS YTD</td>
            <td></td>
            <td></td>
            <td>Units</td>
            <td>${unitsGrandSum}</td>
            ${unitsYTD.map(u => `<td>${u}</td>`).join('')}
        </tr>
        <tr class="row-ytd">
            <td>SQM YTD</td>
            <td></td>
            <td></td>
            <td>Sqm</td>
            <td>${sqmGrandSum.toLocaleString('id-ID')}</td>
            ${sqmYTD.map(s => `<td>${s.toLocaleString('id-ID')}</td>`).join('')}
        </tr>
        <tr class="row-ytd">
            <td>SALES VALUE YTD</td>
            <td></td>
            <td></td>
            <td>Rupiah</td>
            <td>${valueGrandSum.toLocaleString('id-ID')}</td>
            ${valueYTD.map(v => `<td>${v.toLocaleString('id-ID')}</td>`).join('')}
        </tr>
        </tbody>
    `;
    
    table.innerHTML = html;
    refreshIcons();
}

function updateTargetRevenue(rIdx, field, mIdx, val) {
    val = parseFloat(val) || 0;
    if (mIdx === null) {
        state.data.target_revenue[rIdx][field] = val;
    } else {
        state.data.target_revenue[rIdx][field][mIdx] = val;
    }
    state.isDirty = true;
    updateSyncIndicator(false);
    renderTargetRevenueTable();
}

function addTargetRevenueRow() {
    const name = prompt("Enter new category name (e.g. Townhouse Type 120):");
    if (!name) return;
    
    state.data.target_revenue.push({
        category: name,
        stock_units: 0,
        stock_sqm: 0,
        price_sqm: 0,
        units: Array(12).fill(0),
        sqm: Array(12).fill(0)
    });
    state.isDirty = true;
    updateSyncIndicator(false);
    renderTargetRevenueTable();
}

function editTargetRevenueCategory(rIdx) {
    const current = state.data.target_revenue[rIdx].category;
    const name = prompt("Edit category name:", current);
    if (!name || name.trim() === current) return;
    state.data.target_revenue[rIdx].category = name.trim();
    state.isDirty = true;
    updateSyncIndicator(false);
    renderTargetRevenueTable();
}

function deleteTargetRevenueCategory(rIdx) {
    const cat = state.data.target_revenue[rIdx].category;
    if (!confirm(`Delete category "${cat}" and all its data?`)) return;
    state.data.target_revenue.splice(rIdx, 1);
    state.isDirty = true;
    updateSyncIndicator(false);
    renderTargetRevenueTable();
}

// 2. MODULE RENDER: SALES COST & PROGRAM SALES
function renderSalesCostTables() {
    const targetSales = getMonthlyTargetSales();
    
    // Inhouse table
    renderGenericRatiosTable('inhouse-sales-table', state.data.sales_cost.inhouse, targetSales, 'inhouse');
    // Agent table
    renderGenericRatiosTable('agent-sales-table', state.data.sales_cost.agent, targetSales, 'agent');
    // Program cost table
    renderProgramSalesTable(targetSales);
}

function renderGenericRatiosTable(tableId, sourceData, targetSales, typeKey) {
    const table = document.getElementById(tableId);
    
    // Get row keys (exclude metadata keys starting with _)
    const rowKeys = Object.keys(sourceData).filter(k => !k.startsWith('_'));
    
    let html = `
        <thead>
            <tr>
                <th colspan="15" style="padding:8px 0; background:none; border:none;">
                    <button class="btn btn-primary btn-sm" onclick="addSalesCostRow('${typeKey}')"><i data-lucide="plus"></i> Add Row</button>
                </th>
            </tr>
            <tr>
                <th>Cost Component</th>
                <th>Total 2027</th>
                ${months.map(m => `<th>${m}</th>`).join('')}
                <th></th>
            </tr>
        </thead>
        <tbody>
    `;
    
    let monthlyTotals = Array(12).fill(0);
    
    rowKeys.forEach(key => {
        const rowData = sourceData[key];
        const rowSum = rowData.reduce((a, b) => a + b, 0);
        const label = (sourceData._rowLabels && sourceData._rowLabels[key]) || key;
        
        html += `
            <tr>
                <td>${label}</td>
                <td><input type="text" class="table-input readonly" readonly value="${rowSum.toLocaleString('id-ID')}"></td>
                ${rowData.map((val, mIdx) => {
                    monthlyTotals[mIdx] += val;
                    return `<td><input type="number" class="table-input" value="${val}" onchange="updateSalesCost('${typeKey}', '${key}', ${mIdx}, this.value)"></td>`;
                }).join('')}
                <td><button class="btn-icon btn-danger" onclick="deleteSalesCostRow('${typeKey}', '${key}')" title="Delete row">&times;</button></td>
            </tr>
        `;
    });
    
    // Totals and Ratios rows
    const grandSum = monthlyTotals.reduce((a, b) => a + b, 0);
    const targetSalesTotal = targetSales.reduce((a, b) => a + b, 0);
    
    // YTD cumulative
    const salesYTD = [];
    for (let m = 0; m < 12; m++) salesYTD[m] = (salesYTD[m-1] || 0) + monthlyTotals[m];
    
    html += `
        <tr class="row-group-total">
            <td>TOTAL SALES COST</td>
            <td>${grandSum.toLocaleString('id-ID')}</td>
            ${monthlyTotals.map(val => `<td>${val.toLocaleString('id-ID')}</td>`).join('')}
            <td></td>
        </tr>
        <tr class="row-grand-total">
            <td>% Ratio to Target Sales</td>
            ${monthlyTotals.map((val, mIdx) => {
                const ratio = targetSales[mIdx] > 0 ? (val / targetSales[mIdx]) : 0;
                return `<td>${formatPercent(ratio)}</td>`;
            }).join('')}
            <td>${formatPercent(targetSalesTotal > 0 ? (grandSum / targetSalesTotal) : 0)}</td>
            <td></td>
        </tr>
        <tr class="row-ytd">
            <td>SALES COST YTD</td>
            <td>${grandSum.toLocaleString('id-ID')}</td>
            ${salesYTD.map(val => `<td>${val.toLocaleString('id-ID')}</td>`).join('')}
            <td></td>
        </tr>
        </tbody>
    `;
    
    table.innerHTML = html;
}

function addSalesCostRow(typeKey) {
    const name = prompt('Enter cost component name:');
    if (!name || name.trim() === '') return;
    const key = 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    if (!state.data.sales_cost[typeKey]._rowLabels) {
        state.data.sales_cost[typeKey]._rowLabels = {};
    }
    state.data.sales_cost[typeKey][key] = Array(12).fill(0);
    state.data.sales_cost[typeKey]._rowLabels[key] = name.trim();
    state.isDirty = true;
    updateSyncIndicator(false);
    renderSalesCostTables();
}

function deleteSalesCostRow(typeKey, key) {
    if (key.startsWith('custom_') && confirm('Delete this row?')) {
        delete state.data.sales_cost[typeKey][key];
        if (state.data.sales_cost[typeKey]._rowLabels) {
            delete state.data.sales_cost[typeKey]._rowLabels[key];
        }
        state.isDirty = true;
        updateSyncIndicator(false);
        renderSalesCostTables();
    }
}

function updateSalesCost(typeKey, rowKey, mIdx, val) {
    val = parseFloat(val) || 0;
    state.data.sales_cost[typeKey][rowKey][mIdx] = val;
    state.isDirty = true;
    updateSyncIndicator(false);
    renderSalesCostTables();
}

function renderProgramSalesTable(targetSales) {
    const table = document.getElementById('program-sales-table');
    
    // Get row keys (exclude metadata keys starting with _)
    const rowKeys = Object.keys(state.data.program_sales).filter(k => !k.startsWith('_'));
    
    let html = `
        <thead>
            <tr>
                <th colspan="15" style="padding:8px 0; background:none; border:none;">
                    <button class="btn btn-primary btn-sm" onclick="addProgramSalesRow()"><i data-lucide="plus"></i> Add Program Item</button>
                </th>
            </tr>
            <tr>
                <th>Program Component</th>
                <th>Total 2027</th>
                ${months.map(m => `<th>${m}</th>`).join('')}
                <th></th>
            </tr>
        </thead>
        <tbody>
    `;
    
    let monthlyTotals = Array(12).fill(0);
    
    rowKeys.forEach(key => {
        const rowData = state.data.program_sales[key];
        const rowSum = rowData.reduce((a, b) => a + b, 0);
        const label = (state.data.program_sales._rowLabels && state.data.program_sales._rowLabels[key]) || key;
        
        html += `
            <tr>
                <td>${label}</td>
                <td><input type="text" class="table-input readonly" readonly value="${rowSum.toLocaleString('id-ID')}"></td>
                ${rowData.map((val, mIdx) => {
                    monthlyTotals[mIdx] += val;
                    return `<td><input type="number" class="table-input" value="${val}" onchange="updateProgramSales('${key}', ${mIdx}, this.value)"></td>`;
                }).join('')}
                <td><button class="btn-icon btn-danger" onclick="deleteProgramSalesRow('${key}')" title="Delete row">&times;</button></td>
            </tr>
        `;
    });
    
    // Totals and Ratios rows
    const grandSum = monthlyTotals.reduce((a, b) => a + b, 0);
    const targetSalesTotal = targetSales.reduce((a, b) => a + b, 0);
    
    // YTD cumulative
    const progYTD = [];
    for (let m = 0; m < 12; m++) progYTD[m] = (progYTD[m-1] || 0) + monthlyTotals[m];
    
    html += `
        <tr class="row-group-total">
            <td>TOTAL PROGRAM SALES</td>
            <td>${grandSum.toLocaleString('id-ID')}</td>
            ${monthlyTotals.map(val => `<td>${val.toLocaleString('id-ID')}</td>`).join('')}
            <td></td>
        </tr>
        <tr class="row-grand-total">
            <td>% Ratio to Target Sales</td>
            ${monthlyTotals.map((val, mIdx) => {
                const ratio = targetSales[mIdx] > 0 ? (val / targetSales[mIdx]) : 0;
                return `<td>${formatPercent(ratio)}</td>`;
            }).join('')}
            <td>${formatPercent(targetSalesTotal > 0 ? (grandSum / targetSalesTotal) : 0)}</td>
            <td></td>
        </tr>
        <tr class="row-ytd">
            <td>PROGRAM SALES YTD</td>
            <td>${grandSum.toLocaleString('id-ID')}</td>
            ${progYTD.map(val => `<td>${val.toLocaleString('id-ID')}</td>`).join('')}
            <td></td>
        </tr>
        </tbody>
    `;
    
    table.innerHTML = html;
}

function addProgramSalesRow() {
    const name = prompt('Enter program component name:');
    if (!name || name.trim() === '') return;
    const key = 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    if (!state.data.program_sales._rowLabels) {
        state.data.program_sales._rowLabels = {};
    }
    state.data.program_sales[key] = Array(12).fill(0);
    state.data.program_sales._rowLabels[key] = name.trim();
    state.isDirty = true;
    updateSyncIndicator(false);
    renderSalesCostTables();
}

function deleteProgramSalesRow(key) {
    if (key.startsWith('custom_') && confirm('Delete this row?')) {
        delete state.data.program_sales[key];
        if (state.data.program_sales._rowLabels) {
            delete state.data.program_sales._rowLabels[key];
        }
        state.isDirty = true;
        updateSyncIndicator(false);
        renderSalesCostTables();
    }
}

function updateProgramSales(rowKey, mIdx, val) {
    val = parseFloat(val) || 0;
    state.data.program_sales[rowKey][mIdx] = val;
    state.isDirty = true;
    updateSyncIndicator(false);
    renderSalesCostTables();
}

// 3. MODULE RENDER: MARKETING ACTIVITY
function renderMarketingActivityTables() {
    renderMarketingSubTable('atl-marketing-table', 'Above-The-Line');
    renderMarketingSubTable('btl-marketing-table', 'Below-The-Line');
}

function renderMarketingSubTable(tableId, typeText) {
    const table = document.getElementById(tableId);
    
    let html = `
        <thead>
            <tr>
                <th>Marketing Activity Component</th>
                <th>Classification</th>
                <th>Total Budget</th>
                ${months.map(m => `<th>${m}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
    `;
    
    let monthlyTotals = Array(12).fill(0);
    
    const filterRows = state.templates.marketing.filter(item => {
        if (typeText === 'Above-The-Line') {
            return item.row < 46;
        } else {
            return item.row >= 46;
        }
    });
    
    filterRows.forEach(item => {
        if (item.type === 'main_header') {
            html += `<tr class="row-group-header" style="background-color:rgba(139, 92, 246, 0.15)"><td colspan="15">${item.name}</td></tr>`;
        } else if (item.type === 'sub_header') {
            html += `<tr class="row-group-header"><td colspan="15">${item.name}</td></tr>`;
        } else if (item.type === 'category_header') {
            html += `<tr style="font-weight:600; color:#d1d5db"><td colspan="15">${item.name}</td></tr>`;
        } else if (item.type === 'input') {
            const mValues = state.data.marketing_activity[item.row] || Array(12).fill(0);
            const rowSum = mValues.reduce((a, b) => a + b, 0);
            
            html += `
                <tr>
                    <td style="padding-left:30px;">${item.name}</td>
                    <td><span style="font-size:0.75rem; color:var(--text-secondary)">${item.classification}</span></td>
                    <td><input type="text" class="table-input readonly" readonly value="${rowSum.toLocaleString('id-ID')}"></td>
                    ${mValues.map((val, mIdx) => {
                        monthlyTotals[mIdx] += val;
                        return `<td><input type="number" class="table-input" value="${val}" onchange="updateMarketingActivity(${item.row}, ${mIdx}, this.value)"></td>`;
                    }).join('')}
                </tr>
            `;
        }
    });
    
    const grandSum = monthlyTotals.reduce((a, b) => a + b, 0);
    
    html += `
        <tr class="row-grand-total">
            <td colspan="2">TOTAL ${typeText.toUpperCase()}</td>
            <td>${grandSum.toLocaleString('id-ID')}</td>
            ${monthlyTotals.map(val => `<td>${val.toLocaleString('id-ID')}</td>`).join('')}
        </tr>
        </tbody>
    `;
    
    table.innerHTML = html;
}

function updateMarketingActivity(rowId, mIdx, val) {
    val = parseFloat(val) || 0;
    if (!state.data.marketing_activity[rowId]) {
        state.data.marketing_activity[rowId] = Array(12).fill(0);
    }
    state.data.marketing_activity[rowId][mIdx] = val;
    state.isDirty = true;
    updateSyncIndicator(false);
    renderMarketingActivityTables();
}

// 4. MODULE RENDER: DEV & LAND
function renderDevLandTable() {
    const table = document.getElementById('dev-land-table');
    
    let html = `
        <thead>
            <tr>
                <th style="width:50px">No</th>
                <th style="min-width:260px">Category / Item Description</th>
                <th>SQM</th>
                <th>Cost / sqm</th>
                <th>RAB / SPK Value</th>
                <th>Realisasi (YTD July 26)</th>
                <th>Est. (Aug-Dec 26)</th>
                <th>% Realisasi</th>
                <th>Total Budget</th>
                ${months.map(m => `<th>${m}</th>`).join('')}
                <th></th>
            </tr>
        </thead>
        <tbody>
    `;
    
    let monthlyTotals = Array(12).fill(0);

    // Compute subtotals per header item index upfront
    const headerSums = {};
    const items = state.templates.dev_land;

    items.forEach((item, idx) => {
        const text = (item.subcat || item.cat || '').trim();
        const isNote = item.cat === 'Catatan' || text.startsWith('1. Nilai') || text.startsWith('2. Apabila') || text.startsWith('3. Apabila') || text.startsWith('4. Agar') || text.startsWith('Catatan') || text === 'TOTAL LAND & DEVELOPMENT COST';
        const isHeader = isNote || !item.row;

        if (isHeader) {
            // Find all child input items belonging under this header until the next header
            let childIdx = idx + 1;
            let hSqm = 0, hRab = 0, hReal = 0, hEst = 0;
            const hMonthly = Array(12).fill(0);

            while (childIdx < items.length) {
                const child = items[childIdx];
                const cText = (child.subcat || child.cat || '').trim();
                const cIsNote = child.cat === 'Catatan' || cText.startsWith('1. Nilai') || cText.startsWith('2. Apabila') || cText.startsWith('3. Apabila') || cText.startsWith('4. Agar') || cText.startsWith('Catatan') || cText === 'TOTAL LAND & DEVELOPMENT COST';
                const cIsHeader = cIsNote || !child.row;

                if (cIsHeader) break; // Next header encountered

                const key = child.row;
                const dRow = state.data.dev_land[key] || { sqm: 0, cost_sqm: 0, rab_spk: 0, realisasi: 0, best_est: 0, monthly: Array(12).fill(0) };
                hSqm += parseFloat(dRow.sqm) || 0;
                hRab += parseFloat(dRow.rab_spk) || 0;
                hReal += parseFloat(dRow.realisasi) || 0;
                hEst += parseFloat(dRow.best_est) || 0;
                (dRow.monthly || Array(12).fill(0)).forEach((v, m) => hMonthly[m] += v);

                childIdx++;
            }

            headerSums[idx] = { sqm: hSqm, rab: hRab, real: hReal, est: hEst, monthly: hMonthly };
        }
    });

    state.templates.dev_land.forEach((item, itemIdx) => {
        const text = (item.subcat || item.cat || '').trim();
        const isNote = item.cat === 'Catatan' || text.startsWith('1. Nilai') || text.startsWith('2. Apabila') || text.startsWith('3. Apabila') || text.startsWith('4. Agar') || text.startsWith('Catatan') || text === 'TOTAL LAND & DEVELOPMENT COST';

        if (isNote) {
            if (text === 'Catatan' || text.startsWith('Catatan')) {
                html += `
                    <tr style="background:rgba(255,255,255,0.03); font-weight:700; color:var(--text-secondary)">
                        <td colspan="22" style="padding-top:16px;">Catatan:</td>
                    </tr>`;
            } else if (text.startsWith('1. ') || text.startsWith('2. ') || text.startsWith('3. ') || text.startsWith('4. ')) {
                html += `
                    <tr style="background:rgba(255,255,255,0.01); color:var(--text-muted); font-size:0.8rem">
                        <td colspan="22" style="padding:4px 12px;">${text}</td>
                    </tr>`;
            }
        } else if (!item.num && !item.cat && !item.subcat) {
            // Spacer row
        } else if (item.type === 'section_header' || (item.num && !item.cat.includes('.'))) {
            const numDisp = item.num || '';
            const titleDisp = item.cat || item.subcat || '';
            
            // Collect section aggregate across all sub-headers if top-level section 1 or 2
            let secSqm = 0, secRab = 0, secReal = 0, secEst = 0;
            const secMonthly = Array(12).fill(0);
            
            items.forEach((it, i) => {
                const itNum = it.num || it.cat || '';
                if (numDisp === '1' && (itNum.startsWith('1.') || it.cat?.includes('Land Cost'))) {
                    const hs = headerSums[i];
                    if (hs) { secSqm += hs.sqm; secRab += hs.rab; secReal += hs.real; secEst += hs.est; hs.monthly.forEach((v,m)=>secMonthly[m]+=v); }
                } else if (numDisp === '2' && (itNum.startsWith('2.') || it.cat?.includes('Hard Cost') || it.cat?.includes('Soft Cost'))) {
                    const hs = headerSums[i];
                    if (hs) { secSqm += hs.sqm; secRab += hs.rab; secReal += hs.real; secEst += hs.est; hs.monthly.forEach((v,m)=>secMonthly[m]+=v); }
                }
            });

            const totalEstSpent = secReal + secEst;
            const pctReal = secRab > 0 ? (totalEstSpent / secRab) : 0;
            const bSum = secMonthly.reduce((a,b)=>a+b,0);
            const costPerSqm = secSqm > 0 ? (secRab / secSqm) : 0;

            html += `
                <tr class="row-grand-total" style="background:rgba(139,92,246,0.25) !important; font-size:0.9rem;">
                    <td style="font-weight:800; text-align:center;">${numDisp}</td>
                    <td style="font-weight:800; letter-spacing:0.03em;">${titleDisp}</td>
                    <td style="font-weight:700">${secSqm ? secSqm.toLocaleString('id-ID') : '-'}</td>
                    <td style="font-weight:700">${costPerSqm ? Math.round(costPerSqm).toLocaleString('id-ID') : '-'}</td>
                    <td style="font-weight:700">${secRab ? secRab.toLocaleString('id-ID') : '-'}</td>
                    <td style="font-weight:700">${secReal ? secReal.toLocaleString('id-ID') : '-'}</td>
                    <td style="font-weight:700">${secEst ? secEst.toLocaleString('id-ID') : '-'}</td>
                    <td style="font-weight:700; color:var(--text-secondary)">${formatPercent(pctReal)}</td>
                    <td style="font-weight:800; color:#a78bfa">${bSum ? bSum.toLocaleString('id-ID') : '-'}</td>
                    ${secMonthly.map(v => `<td style="font-weight:700">${v ? v.toLocaleString('id-ID') : '-'}</td>`).join('')}
                    <td></td>
                </tr>`;
        } else if ((item.cat && item.cat.includes('.')) || (item.num && item.num.includes('.')) || item.cat === 'Hard Cost' || item.cat === 'Soft Cost') {
            const numDisp = item.num || item.cat;
            const titleDisp = item.subcat || item.cat;
            const hs = headerSums[itemIdx] || { sqm: 0, rab: 0, real: 0, est: 0, monthly: Array(12).fill(0) };

            const totalEstSpent = hs.real + hs.est;
            const pctReal = hs.rab > 0 ? (totalEstSpent / hs.rab) : 0;
            const bSum = hs.monthly.reduce((a,b)=>a+b,0);
            const costPerSqm = hs.sqm > 0 ? (hs.rab / hs.sqm) : 0;

            html += `
                <tr class="row-group-header">
                    <td style="font-weight:700; text-align:center;">${numDisp}</td>
                    <td style="font-weight:700">
                        ${titleDisp}
                        ${item.cat !== 'Hard Cost' && item.cat !== 'Soft Cost' ? `<button class="btn btn-secondary btn-sm" onclick="addDevLandSubRow(${itemIdx})" title="Add sub-row under this header" style="font-size:0.7rem; padding:2px 8px; margin-left:10px;"><i data-lucide="plus"></i> Sub-Row</button>` : ''}
                    </td>
                    <td style="font-weight:700">${hs.sqm ? hs.sqm.toLocaleString('id-ID') : '-'}</td>
                    <td style="font-weight:700">${costPerSqm ? Math.round(costPerSqm).toLocaleString('id-ID') : '-'}</td>
                    <td style="font-weight:700">${hs.rab ? hs.rab.toLocaleString('id-ID') : '-'}</td>
                    <td style="font-weight:700">${hs.real ? hs.real.toLocaleString('id-ID') : '-'}</td>
                    <td style="font-weight:700">${hs.est ? hs.est.toLocaleString('id-ID') : '-'}</td>
                    <td style="font-weight:700; color:var(--text-secondary)">${formatPercent(pctReal)}</td>
                    <td style="font-weight:700; color:var(--accent-indigo)">${bSum ? bSum.toLocaleString('id-ID') : '-'}</td>
                    ${hs.monthly.map(v => `<td style="font-weight:700">${v ? v.toLocaleString('id-ID') : '-'}</td>`).join('')}
                    <td></td>
                </tr>`;
        } else {
            // Input rows
            const key = item.row;
            const dataRow = state.data.dev_land[key] || { name: (item.subcat || item.cat || ''), sqm: 0, cost_sqm: 0, rab_spk: 0, realisasi: 0, best_est: 0, monthly: Array(12).fill(0) };
            
            const totalEstSpent = dataRow.realisasi + dataRow.best_est;
            const pctReal = dataRow.rab_spk > 0 ? (totalEstSpent / dataRow.rab_spk) : 0;
            const budgetSum = dataRow.monthly.reduce((a, b) => a + b, 0);
            
            const numDisp = item.num || '';
            const descValue = dataRow.name !== undefined ? dataRow.name : (item.subcat || item.cat || '');
            
            html += `
                <tr>
                    <td style="font-weight:600; color:var(--text-secondary); text-align:center;">${numDisp}</td>
                    <td>
                        <input type="text" class="table-input" style="width:100%; text-align:left; font-weight:500;" value="${descValue}" placeholder="Description / Item Name" onchange="updateDevLandName('${key}', ${itemIdx}, this.value)">
                    </td>
                    <td><input type="number" class="table-input" style="width:75px" value="${dataRow.sqm}" onchange="updateDevLand('${key}', 'sqm', this.value)"></td>
                    <td><input type="number" class="table-input" style="width:90px" value="${dataRow.cost_sqm}" onchange="updateDevLand('${key}', 'cost_sqm', this.value)"></td>
                    <td><input type="number" class="table-input" style="width:110px" value="${dataRow.rab_spk}" onchange="updateDevLand('${key}', 'rab_spk', this.value)"></td>
                    <td><input type="number" class="table-input" style="width:110px" value="${dataRow.realisasi}" onchange="updateDevLand('${key}', 'realisasi', this.value)"></td>
                    <td><input type="number" class="table-input" style="width:110px" value="${dataRow.best_est}" onchange="updateDevLand('${key}', 'best_est', this.value)"></td>
                    <td><span style="font-weight:600; color:var(--text-secondary)">${formatPercent(pctReal)}</span></td>
                    <td><input type="text" class="table-input readonly" readonly value="${budgetSum.toLocaleString('id-ID')}"></td>
                    ${dataRow.monthly.map((val, mIdx) => {
                        monthlyTotals[mIdx] += val;
                        return `<td><input type="number" class="table-input" value="${val}" onchange="updateDevLand('${key}', 'monthly', this.value, ${mIdx})"></td>`;
                    }).join('')}
                    <td class="action-cell">
                        <button class="btn-delete" onclick="removeDevLandSubRow('${key}', ${itemIdx})"><i data-lucide="trash-2"></i></button>
                    </td>
                </tr>
            `;
        }
    });
    
    const grandSum = monthlyTotals.reduce((a, b) => a + b, 0);
    
    // YTD cumulative
    const devYTD = [];
    for (let m = 0; m < 12; m++) devYTD[m] = (devYTD[m-1] || 0) + monthlyTotals[m];
    
    html += `
        <tr class="row-grand-total">
            <td colspan="8">TOTAL LAND & DEVELOPMENT PLAN COST</td>
            <td>${grandSum.toLocaleString('id-ID')}</td>
            ${monthlyTotals.map(val => `<td>${val.toLocaleString('id-ID')}</td>`).join('')}
            <td></td>
        </tr>
        <tr class="row-ytd">
            <td colspan="8">LAND & DEV COST YTD</td>
            <td>${grandSum.toLocaleString('id-ID')}</td>
            ${devYTD.map(val => `<td>${val.toLocaleString('id-ID')}</td>`).join('')}
            <td></td>
        </tr>
        <tr>
            <td colspan="22" style="padding:10px 0; background:none; border:none;">
                <button class="btn btn-primary btn-sm" onclick="addDevLandCategory()"><i data-lucide="plus"></i> Add Category Header</button>
            </td>
        </tr>
        </tbody>
    `;
    
    table.innerHTML = html;
    refreshIcons();
}

function updateDevLandName(key, itemIdx, val) {
    if (!state.data.dev_land[key]) {
        state.data.dev_land[key] = { name: val, sqm: 0, cost_sqm: 0, rab_spk: 0, realisasi: 0, best_est: 0, monthly: Array(12).fill(0) };
    } else {
        state.data.dev_land[key].name = val;
    }
    if (state.templates.dev_land[itemIdx]) {
        state.templates.dev_land[itemIdx].subcat = val;
    }
    state.isDirty = true;
    updateSyncIndicator(false);
}

function addDevLandSubRow(headerIdx) {
    const letters = ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p'];
    // Count existing sub-rows under this header
    let insertAt = headerIdx + 1;
    let subCount = 0;
    while (insertAt < state.templates.dev_land.length && !state.templates.dev_land[insertAt].num?.includes('.') && !state.templates.dev_land[insertAt].cat?.includes('.') && state.templates.dev_land[insertAt].type !== 'section_header') {
        subCount++;
        insertAt++;
    }
    const letter = letters[subCount] || `sub_${subCount+1}`;
    const name = prompt(`Enter item name for sub-row (${letter}):`, letter);
    if (name === null) return;
    
    const key = 'dl_custom_' + Date.now();
    state.templates.dev_land.splice(insertAt, 0, {
        num: letter,
        cat: '',
        subcat: name.trim() || letter,
        row: key
    });
    state.data.dev_land[key] = { name: name.trim() || letter, sqm: 0, cost_sqm: 0, rab_spk: 0, realisasi: 0, best_est: 0, monthly: Array(12).fill(0) };
    state.isDirty = true;
    updateSyncIndicator(false);
    renderDevLandTable();
}

function removeDevLandSubRow(key, itemIdx) {
    if (!confirm('Delete this sub-row item?')) return;
    if (key && state.data.dev_land[key]) {
        delete state.data.dev_land[key];
    }
    state.templates.dev_land.splice(itemIdx, 1);
    state.isDirty = true;
    updateSyncIndicator(false);
    renderDevLandTable();
}

function addDevLandCategory() {
    const catName = prompt('Enter category name (e.g. "3. Infrastruktur"):');
    if (!catName || catName.trim() === '') return;
    const subName = prompt('Enter sub-category / item name:');
    if (!subName || subName.trim() === '') return;
    const key = 'custom_dl_' + Date.now();
    // Add to templates runtime (session only — saved via budget data)
    if (!state.templates.dev_land_custom) state.templates.dev_land_custom = [];
    state.templates.dev_land.push({
        num: catName.trim(),
        cat: catName.trim(),
        subcat: subName.trim(),
        row: key,
        sqm: 0, cost_sqm: 0, rab_spk: 0, realisasi: 0, best_est: 0
    });
    state.data.dev_land[key] = { sqm: 0, cost_sqm: 0, rab_spk: 0, realisasi: 0, best_est: 0, monthly: Array(12).fill(0) };
    state.isDirty = true;
    updateSyncIndicator(false);
    renderDevLandTable();
}

function updateDevLand(key, field, val, mIdx = null) {
    val = parseFloat(val) || 0;
    if (!state.data.dev_land[key]) {
        state.data.dev_land[key] = { sqm: 0, cost_sqm: 0, rab_spk: 0, realisasi: 0, best_est: 0, monthly: Array(12).fill(0) };
    }
    
    if (field === 'monthly') {
        state.data.dev_land[key].monthly[mIdx] = val;
    } else {
        state.data.dev_land[key][field] = val;
    }
    state.isDirty = true;
    updateSyncIndicator(false);
    renderDevLandTable();
}

// 5. MODULE RENDER: BUDGET PAYROLL (COA-based)
function renderPayrollTable() {
    renderExpensesSubTable('employee-table', state.templates.payroll, state.data.payroll_expenses, 'payroll');
}

function updatePayroll(code, mIdx, val) {
    val = parseFloat(val) || 0;
    if (!state.data.payroll_expenses[code]) {
        state.data.payroll_expenses[code] = Array(12).fill(0);
    }
    state.data.payroll_expenses[code][mIdx] = val;
    state.isDirty = true;
    updateSyncIndicator(false);
    renderPayrollTable();
}

function renderHCProgramList() {
    const body = document.getElementById('hc-program-body');
    
    if (state.data.hc_program.length === 0) {
        body.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-secondary); padding:24px;">No human capital activities planned. Click 'Add Program Activity' above.</td></tr>`;
        return;
    }
    
    // Select option templates for COA
    const coaOpts = state.metadata.anp.map(opt => `<option value="${opt}">${opt}</option>`).join('');
    
    body.innerHTML = state.data.hc_program.map((row, idx) => {
        const total = row.qty * row.price;
        return `
            <tr>
                <td><input type="text" value="${row.topic}" placeholder="e.g. Leadership Training" onchange="updateHCProgram(${idx}, 'topic', this.value)"></td>
                <td><input type="text" value="${row.institution}" placeholder="e.g. PPM Manajemen" onchange="updateHCProgram(${idx}, 'institution', this.value)"></td>
                <td>
                    <select onchange="updateHCProgram(${idx}, 'category', this.value)">
                        <option value="${row.category}">${row.category}</option>
                        ${coaOpts}
                    </select>
                </td>
                <td><input type="number" style="width:70px" value="${row.qty}" onchange="updateHCProgram(${idx}, 'qty', this.value)"></td>
                <td><input type="number" style="width:120px" value="${row.price}" onchange="updateHCProgram(${idx}, 'price', this.value)"></td>
                <td><span style="font-weight:600">${total.toLocaleString('id-ID')}</span></td>
                <td>
                    <select style="width:90px" onchange="updateHCProgram(${idx}, 'month', this.value)">
                        ${months.map((m, mIdx) => `<option value="${mIdx}" ${row.month == mIdx ? 'selected' : ''}>${m}</option>`).join('')}
                    </select>
                </td>
                <td class="action-cell">
                    <button class="btn-delete" onclick="removeHCProgramRow(${idx})"><i data-lucide="trash-2"></i></button>
                </td>
            </tr>
        `;
    }).join('');
    refreshIcons();
}

function addHCProgramRow() {
    state.data.hc_program.push({
        id: 'hc_' + Date.now(),
        topic: '',
        institution: '',
        category: 'Training & Development',
        qty: 1,
        price: 0,
        currency: 'IDR',
        month: 0
    });
    state.isDirty = true;
    updateSyncIndicator(false);
    renderHCProgramList();
}

function updateHCProgram(idx, field, val) {
    if (field === 'qty' || field === 'price' || field === 'month') {
        val = parseFloat(val) || 0;
    }
    state.data.hc_program[idx][field] = val;
    state.isDirty = true;
    updateSyncIndicator(false);
    renderHCProgramList();
}

function removeHCProgramRow(idx) {
    state.data.hc_program.splice(idx, 1);
    state.isDirty = true;
    updateSyncIndicator(false);
    renderHCProgramList();
}

// 6. MODULE RENDER: G&A, OTHERS, FINANCE, TAX
function renderGAOthersTables() {
    renderExpensesSubTable('ga-table', state.templates.ga, state.data.ga_expenses, 'ga');
    renderExpensesSubTable('others-table', state.templates.others, state.data.others_expenses, 'others');
    renderExpensesSubTable('finance-table', state.templates.finance, state.data.finance_expenses, 'finance');
    renderExpensesSubTable('tax-table', state.templates.tax, state.data.tax_expenses, 'tax');
}

function renderExpensesSubTable(tableId, accountsMeta, sourceData, keyPrefix) {
    const table = document.getElementById(tableId);
    
    let html = `
        <thead>
            <tr>
                <th>Account ID</th>
                <th>Account Description</th>
                <th>Total Budget</th>
                ${months.map(m => `<th>${m}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
    `;
    
    let monthlyTotals = Array(12).fill(0);
    
    accountsMeta.forEach(acc => {
        const mValues = sourceData[acc.code] || Array(12).fill(0);
        const rowSum = mValues.reduce((a, b) => a + b, 0);
        
        html += `
            <tr>
                <td><span style="font-family:monospace; color:var(--text-secondary)">${acc.code}</span></td>
                <td>${acc.name}</td>
                <td><input type="text" class="table-input readonly" readonly value="${rowSum.toLocaleString('id-ID')}"></td>
                ${mValues.map((val, mIdx) => {
                    monthlyTotals[mIdx] += val;
                    return `<td><input type="number" class="table-input" value="${val}" onchange="updateExpensesData('${keyPrefix}', '${acc.code}', ${mIdx}, this.value)"></td>`;
                }).join('')}
            </tr>
        `;
    });
    
    const grandSum = monthlyTotals.reduce((a, b) => a + b, 0);
    
    // YTD cumulative
    const expYTD = [];
    for (let m = 0; m < 12; m++) expYTD[m] = (expYTD[m-1] || 0) + monthlyTotals[m];
    
    html += `
        <tr class="row-grand-total">
            <td colspan="2">TOTAL ${keyPrefix.toUpperCase()} EXPENSES</td>
            <td>${grandSum.toLocaleString('id-ID')}</td>
            ${monthlyTotals.map(val => `<td>${val.toLocaleString('id-ID')}</td>`).join('')}
        </tr>
        <tr class="row-ytd">
            <td colspan="2">${keyPrefix.toUpperCase()} YTD</td>
            <td>${grandSum.toLocaleString('id-ID')}</td>
            ${expYTD.map(val => `<td>${val.toLocaleString('id-ID')}</td>`).join('')}
        </tr>
        </tbody>
    `;
    
    table.innerHTML = html;
}

function updateExpensesData(keyPrefix, accCode, mIdx, val) {
    val = parseFloat(val) || 0;
    const targetStore = keyPrefix === 'ga' ? state.data.ga_expenses :
                       keyPrefix === 'others' ? state.data.others_expenses :
                       keyPrefix === 'finance' ? state.data.finance_expenses :
                       keyPrefix === 'payroll' ? state.data.payroll_expenses :
                       state.data.tax_expenses;
                       
    if (!targetStore[accCode]) {
        targetStore[accCode] = Array(12).fill(0);
    }
    targetStore[accCode][mIdx] = val;
    state.isDirty = true;
    updateSyncIndicator(false);
    if (keyPrefix === 'payroll') {
        renderPayrollTable();
    } else {
        renderGAOthersTables();
    }
}

// 7. MODULE RENDER: CORPORATE EVENTS
function renderCorpEventTable() {
    const table = document.getElementById('corp-event-table');
    
    let html = `
        <thead>
            <tr>
                <th colspan="18" style="padding:8px 0; background:none; border:none;">
                    <button class="btn btn-primary btn-sm" onclick="addCorpEventCategory()"><i data-lucide="plus"></i> Add Category</button>
                </th>
            </tr>
            <tr>
                <th>Corporate Event Activity</th>
                <th>Classification</th>
                <th>Unit Qty</th>
                <th>Price / Unit</th>
                <th>Estimated Subtotal</th>
                <th>Total budget</th>
                ${months.map(m => `<th>${m}</th>`).join('')}
                <th></th>
            </tr>
        </thead>
        <tbody>
    `;
    
    let monthlyTotals = Array(12).fill(0);
    
    state.templates.corp_event.forEach((item, itemIdx) => {
        if (item.type === 'header') {
            html += `
                <tr class="row-group-header">
                    <td colspan="17" style="font-weight:700; font-size:0.95rem;">${item.activity}</td>
                    <td style="background:none;">
                        <button class="btn btn-secondary btn-sm" onclick="addCorpEventDetail(${itemIdx})" title="Add detail row under this category" style="font-size:0.7rem; padding:3px 8px;"><i data-lucide="plus"></i> Detail</button>
                        <button class="btn-icon btn-danger" onclick="removeCorpEventCategory(${itemIdx})" title="Remove category">&times;</button>
                    </td>
                </tr>`;
        } else {
            const key = item.row;
            const dataRow = state.data.corp_events[key] || { qty: 0, price_unit: 0, monthly: Array(12).fill(0) };
            
            const subtotal = dataRow.qty * dataRow.price_unit;
            const monthlySum = dataRow.monthly.reduce((a, b) => a + b, 0);
            
            html += `
                <tr>
                    <td style="padding-left:30px;">${item.activity}</td>
                    <td><span style="font-size:0.75rem; color:var(--text-secondary)">${item.classification || ''}</span></td>
                    <td><input type="number" class="table-input" style="width:75px" value="${dataRow.qty}" onchange="updateCorpEvent('${key}', 'qty', this.value)"></td>
                    <td><input type="number" class="table-input" style="width:110px" value="${dataRow.price_unit}" onchange="updateCorpEvent('${key}', 'price_unit', this.value)"></td>
                    <td><span style="font-weight:600">${subtotal.toLocaleString('id-ID')}</span></td>
                    <td><input type="text" class="table-input readonly" readonly value="${monthlySum.toLocaleString('id-ID')}"></td>
                    ${dataRow.monthly.map((val, mIdx) => {
                        monthlyTotals[mIdx] += val;
                        return `<td><input type="number" class="table-input" value="${val}" onchange="updateCorpEvent('${key}', 'monthly', this.value, ${mIdx})"></td>`;
                    }).join('')}
                    <td class="action-cell"><button class="btn-delete" onclick="removeCorpEventDetail(${itemIdx})"><i data-lucide="trash-2"></i></button></td>
                </tr>
            `;
        }
    });
    
    const grandSum = monthlyTotals.reduce((a, b) => a + b, 0);
    
    // YTD cumulative
    const corpYTD = [];
    for (let m = 0; m < 12; m++) corpYTD[m] = (corpYTD[m-1] || 0) + monthlyTotals[m];
    
    html += `
        <tr class="row-grand-total">
            <td colspan="5">TOTAL CORPORATE EVENT & EXHIBITIONS</td>
            <td>${grandSum.toLocaleString('id-ID')}</td>
            ${monthlyTotals.map(val => `<td>${val.toLocaleString('id-ID')}</td>`).join('')}
            <td></td>
        </tr>
        <tr class="row-ytd">
            <td colspan="5">CORPORATE EVENT YTD</td>
            <td>${grandSum.toLocaleString('id-ID')}</td>
            ${corpYTD.map(val => `<td>${val.toLocaleString('id-ID')}</td>`).join('')}
            <td></td>
        </tr>
        </tbody>
    `;
    
    table.innerHTML = html;
    refreshIcons();
}

function addCorpEventCategory() {
    const catName = prompt('Enter category title (e.g. "Town Hall Meeting"):');
    if (!catName || catName.trim() === '') return;
    state.templates.corp_event.push({ type: 'header', activity: catName.trim(), row: null });
    state.isDirty = true;
    updateSyncIndicator(false);
    renderCorpEventTable();
}

function addCorpEventDetail(categoryIdx) {
    const detailName = prompt('Enter detail activity name:');
    if (!detailName || detailName.trim() === '') return;
    const classification = prompt('Classification (e.g. "Internal", "External", "CSR"):') || '';
    const key = 'ce_custom_' + Date.now();
    // Insert detail right after the category header (or at end if last)
    let insertAt = categoryIdx + 1;
    // Skip past existing detail rows under this header
    while (insertAt < state.templates.corp_event.length && state.templates.corp_event[insertAt].type !== 'header') {
        insertAt++;
    }
    state.templates.corp_event.splice(insertAt, 0, {
        type: 'input',
        activity: detailName.trim(),
        classification: classification.trim(),
        row: key
    });
    state.data.corp_events[key] = { qty: 0, price_unit: 0, monthly: Array(12).fill(0) };
    state.isDirty = true;
    updateSyncIndicator(false);
    renderCorpEventTable();
}

function removeCorpEventCategory(itemIdx) {
    if (!confirm('Remove this category and all its detail rows?')) return;
    // Remove header and all following detail rows
    let end = itemIdx + 1;
    while (end < state.templates.corp_event.length && state.templates.corp_event[end].type !== 'header') end++;
    state.templates.corp_event.splice(itemIdx, end - itemIdx);
    state.isDirty = true;
    updateSyncIndicator(false);
    renderCorpEventTable();
}

function removeCorpEventDetail(itemIdx) {
    if (!confirm('Remove this detail row?')) return;
    const key = state.templates.corp_event[itemIdx].row;
    if (key) delete state.data.corp_events[key];
    state.templates.corp_event.splice(itemIdx, 1);
    state.isDirty = true;
    updateSyncIndicator(false);
    renderCorpEventTable();
}

function updateCorpEvent(key, field, val, mIdx = null) {
    val = parseFloat(val) || 0;
    if (!state.data.corp_events[key]) {
        state.data.corp_events[key] = { qty: 0, price_unit: 0, monthly: Array(12).fill(0) };
    }
    
    if (field === 'monthly') {
        state.data.corp_events[key].monthly[mIdx] = val;
    } else {
        state.data.corp_events[key][field] = val;
    }
    state.isDirty = true;
    updateSyncIndicator(false);
    renderCorpEventTable();
}

// 8. MODULE RENDER: FIXED ASSETS (CAPEX)
function renderFixedAssetsTable() {
    const body = document.getElementById('fa-list-body');
    
    if (state.data.fixed_assets.length === 0) {
        body.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--text-secondary); padding:24px;">No Capital expenditure requested for 2027. Click 'Request Fixed Asset' to start.</td></tr>`;
        return;
    }
    
    const categories = ['IT Hardware & Software', 'Kendaraan Operasional', 'Peralatan Kantor', 'Furnitur dan Perlengkapan Kantor', 'Peralatan Lainnya'];
    const justifications = ['Must To Have', 'Nice To Have'];
    
    body.innerHTML = state.data.fixed_assets.map((row, idx) => {
        const total = row.qty * row.price;
        return `
            <tr>
                <td><input type="text" value="${row.division}" placeholder="e.g. Sales" onchange="updateFixedAsset(${idx}, 'division', this.value)"></td>
                <td>
                    <select onchange="updateFixedAsset(${idx}, 'category', this.value)">
                        ${categories.map(c => `<option value="${c}" ${row.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                </td>
                <td><input type="text" value="${row.desc}" placeholder="e.g. Laptop Core i7" onchange="updateFixedAsset(${idx}, 'desc', this.value)"></td>
                <td>
                    <select style="width:85px" onchange="updateFixedAsset(${idx}, 'new_replace', this.value)">
                        <option value="New" ${row.new_replace === 'New' ? 'selected' : ''}>New</option>
                        <option value="Replace" ${row.new_replace === 'Replace' ? 'selected' : ''}>Replace</option>
                    </select>
                </td>
                <td><input type="number" style="width:70px" value="${row.qty}" onchange="updateFixedAsset(${idx}, 'qty', this.value)"></td>
                <td><input type="number" style="width:115px" value="${row.price}" onchange="updateFixedAsset(${idx}, 'price', this.value)"></td>
                <td><span style="font-weight:600">${total.toLocaleString('id-ID')}</span></td>
                <td>
                    <select style="width:90px" onchange="updateFixedAsset(${idx}, 'month', this.value)">
                        ${months.map((m, mIdx) => `<option value="${mIdx}" ${row.month == mIdx ? 'selected' : ''}>${m}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <select style="width:110px" onchange="updateFixedAsset(${idx}, 'justification', this.value)">
                        ${justifications.map(j => `<option value="${j}" ${row.justification === j ? 'selected' : ''}>${j}</option>`).join('')}
                    </select>
                </td>
                <td class="action-cell">
                    <button class="btn-delete" onclick="removeFixedAssetRow(${idx})"><i data-lucide="trash-2"></i></button>
                </td>
            </tr>
        `;
    }).join('');
    refreshIcons();
}

function addFixedAssetRow() {
    state.data.fixed_assets.push({
        id: 'fa_' + Date.now(),
        division: '',
        category: 'IT Hardware & Software',
        desc: '',
        new_replace: 'New',
        qty: 1,
        price: 0,
        currency: 'IDR',
        month: 0,
        justification: 'Must To Have'
    });
    state.isDirty = true;
    updateSyncIndicator(false);
    renderFixedAssetsTable();
}

function updateFixedAsset(idx, field, val) {
    if (field === 'qty' || field === 'price' || field === 'month') {
        val = parseFloat(val) || 0;
    }
    state.data.fixed_assets[idx][field] = val;
    state.isDirty = true;
    updateSyncIndicator(false);
    renderFixedAssetsTable();
}

function removeFixedAssetRow(idx) {
    state.data.fixed_assets.splice(idx, 1);
    state.isDirty = true;
    updateSyncIndicator(false);
    renderFixedAssetsTable();
}

// 9. MODULE RENDER: BUSINESS TRIP
function renderBusinessTripTable() {
    const body = document.getElementById('trip-list-body');
    
    if (state.data.business_trip.length === 0) {
        body.innerHTML = `<tr><td colspan="12" style="text-align:center; color:var(--text-secondary); padding:24px;">No business trips logged for 2027. Click 'Log Business Trip' to add.</td></tr>`;
        return;
    }
    
    const levels = ['Director', 'Manager', 'SPV', 'Staff'];
    const destinations = ['Local', 'Overseas'];
    
    body.innerHTML = state.data.business_trip.map((row, idx) => {
        // Dynamic rates matching Excel travel policy (incl. SPV grade)
        const allowances = {
            'Director': { 'Local': 1500000, 'Overseas': 2000000 },
            'Manager':  { 'Local': 900000,  'Overseas': 1200000 },
            'SPV':      { 'Local': 750000,  'Overseas': 1000000 },
            'Staff':    { 'Local': 600000,  'Overseas': 800000  }
        };
        const hotelRates = {
            'Director': { 'Local': 1650000, 'Overseas': 2500000 },
            'Manager':  { 'Local': 750000,  'Overseas': 1200000 },
            'SPV':      { 'Local': 600000,  'Overseas': 1000000 },
            'Staff':    { 'Local': 500000,  'Overseas': 800000  }
        };
        const standardFlights = { 'Local': 4000000, 'Overseas': 8000000 };
        
        const standardFlight = standardFlights[row.destination];
        const standardHotel = (hotelRates[row.grade] || hotelRates['Staff'])[row.destination];
        const standardAllowance = (allowances[row.grade] || allowances['Staff'])[row.destination];
        
        const totalCost = standardFlight + (standardHotel * Math.max(0, row.duration - 1)) + (standardAllowance * row.duration);
        
        return `
            <tr>
                <td><input type="text" value="${row.employee}" placeholder="e.g. Rudi" onchange="updateTrip(${idx}, 'employee', this.value)"></td>
                <td><input type="text" value="${row.division}" placeholder="e.g. Sales" onchange="updateTrip(${idx}, 'division', this.value)"></td>
                <td>
                    <select style="width:100px" onchange="updateTrip(${idx}, 'grade', this.value)">
                        ${levels.map(l => `<option value="${l}" ${row.grade === l ? 'selected' : ''}>${l}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <select style="width:105px" onchange="updateTrip(${idx}, 'destination', this.value)">
                        ${destinations.map(d => `<option value="${d}" ${row.destination === d ? 'selected' : ''}>${d}</option>`).join('')}
                    </select>
                </td>
                <td><input type="text" value="${row.city}" placeholder="e.g. Jakarta" onchange="updateTrip(${idx}, 'city', this.value)"></td>
                <td>
                    <select style="width:90px" onchange="updateTrip(${idx}, 'month', this.value)">
                        ${months.map((m, mIdx) => `<option value="${mIdx}" ${row.month == mIdx ? 'selected' : ''}>${m}</option>`).join('')}
                    </select>
                </td>
                <td><input type="number" style="width:70px" value="${row.duration}" onchange="updateTrip(${idx}, 'duration', this.value)"></td>
                <td><span>${standardFlight.toLocaleString('id-ID')}</span></td>
                <td><span>${standardHotel.toLocaleString('id-ID')}</span></td>
                <td><span>${standardAllowance.toLocaleString('id-ID')}</span></td>
                <td><span style="font-weight:700">${totalCost.toLocaleString('id-ID')}</span></td>
                <td class="action-cell">
                    <button class="btn-delete" onclick="removeTripRow(${idx})"><i data-lucide="trash-2"></i></button>
                </td>
            </tr>
        `;
    }).join('');
    refreshIcons();
}

function addBusinessTripRow() {
    state.data.business_trip.push({
        id: 'trip_' + Date.now(),
        employee: '',
        division: '',
        grade: 'Staff',
        destination: 'Local',
        city: '',
        month: 0,
        duration: 3,
        ticket_price: 4000000
    });
    state.isDirty = true;
    updateSyncIndicator(false);
    renderBusinessTripTable();
}

function updateTrip(idx, field, val) {
    if (field === 'duration' || field === 'month') {
        val = parseFloat(val) || 0;
    }
    state.data.business_trip[idx][field] = val;
    state.isDirty = true;
    updateSyncIndicator(false);
    renderBusinessTripTable();
}

function removeTripRow(idx) {
    state.data.business_trip.splice(idx, 1);
    state.isDirty = true;
    updateSyncIndicator(false);
    renderBusinessTripTable();
}

// 10. CONSOLIDATED SUMMARY BUDGET TABLE RENDERER
function renderSummaryBudgetTable() {
    const table = document.getElementById('summary-budget-table');

    // ── Initialize 2026 manual input storage if missing ──────────────────
    if (!state.data.summary_2026) {
        state.data.summary_2026 = {};
    }
    const s26 = state.data.summary_2026;
    // Helper: get manual 2026 value for a key, defaulting to 0
    const g26 = (key) => parseFloat(s26[key] || 0);
    // Helper: render an editable 2026 input cell
    const inp26 = (key) => `<td><input type="number" class="table-input" style="width:110px" value="${g26(key)}" onchange="update2026('${key}', this.value)"></td>`;
    // Helper: read-only computed cell
    const ro = (val) => `<td class="cell-computed">${val === 0 ? '-' : Math.round(val).toLocaleString('id-ID')}</td>`;
    // Helper: Bio formatted
    const bio = (val) => (val / 1e9).toFixed(2);
    // Helper: diff % badge
    const diff = (b26, b27) => {
        if (!b26) return `<td>-</td>`;
        const pct = ((b27 - b26) / Math.abs(b26) * 100).toFixed(1);
        const cls = pct > 0 ? 'diff-up' : 'diff-dn';
        return `<td class="${cls}">${pct > 0 ? '+' : ''}${pct}%</td>`;
    };

    // ── Compute Budget 2027 monthly totals from all modules ───────────────
    const mRevenue = Array(12).fill(0), mUnits = Array(12).fill(0), mSqm = Array(12).fill(0);
    state.data.target_revenue.forEach(row => {
        row.sqm.forEach((s,m) => { mRevenue[m] += s * row.price_sqm; mSqm[m] += s; });
        row.units.forEach((u,m) => { mUnits[m] += u; });
    });

    const mSalesInhouse = Array(12).fill(0), mSalesAgent = Array(12).fill(0);
    const mSalesProgram = Array(12).fill(0);
    const mMarketingATL = Array(12).fill(0), mMarketingBTL = Array(12).fill(0);
    const mDevLand = Array(12).fill(0), mEmployee = Array(12).fill(0);
    const mGA = Array(12).fill(0), mOthers = Array(12).fill(0);
    const mFinance = Array(12).fill(0), mTax = Array(12).fill(0);
    const mCorpEvent = Array(12).fill(0), mCapex = Array(12).fill(0);

    for (let m = 0; m < 12; m++) {
        mSalesInhouse[m] = Object.keys(state.data.sales_cost.inhouse).filter(k=>!k.startsWith('_')).reduce((s,k)=>s+state.data.sales_cost.inhouse[k][m],0);
        mSalesAgent[m]   = Object.keys(state.data.sales_cost.agent).filter(k=>!k.startsWith('_')).reduce((s,k)=>s+state.data.sales_cost.agent[k][m],0);
        Object.keys(state.data.program_sales).filter(k=>!k.startsWith('_')).forEach(k=>{ mSalesProgram[m] += state.data.program_sales[k][m]; });
        state.templates.marketing.forEach(item => {
            if (item.type==='input') {
                const v = state.data.marketing_activity[item.row] ? state.data.marketing_activity[item.row][m] : 0;
                if (item.row < 46) mMarketingATL[m] += v; else mMarketingBTL[m] += v;
            }
        });
        Object.keys(state.data.dev_land).forEach(r => { mDevLand[m] += state.data.dev_land[r].monthly[m]; });
        mEmployee[m] = Object.keys(state.data.payroll_expenses).reduce((s,c)=>s+state.data.payroll_expenses[c][m],0);
        Object.keys(state.data.ga_expenses).forEach(c=>{ mGA[m] += state.data.ga_expenses[c][m]; });
        // Business trip costs go into G&A
        const amap = {'Director':{'Local':1500000,'Overseas':2000000},'Manager':{'Local':900000,'Overseas':1200000},'SPV':{'Local':750000,'Overseas':1000000},'Staff':{'Local':600000,'Overseas':800000}};
        const hmap = {'Director':{'Local':1650000,'Overseas':2500000},'Manager':{'Local':750000,'Overseas':1200000},'SPV':{'Local':600000,'Overseas':1000000},'Staff':{'Local':500000,'Overseas':800000}};
        state.data.business_trip.forEach(r => {
            if (r.month == m) {
                const g=r.grade||'Staff', d=r.destination||'Local';
                const flt = r.ticket_price != null ? r.ticket_price : (d==='Overseas'?8000000:4000000);
                mGA[m] += flt + ((hmap[g]||hmap.Staff)[d]) * Math.max(0,r.duration-1) + ((amap[g]||amap.Staff)[d]) * r.duration;
            }
        });
        Object.keys(state.data.others_expenses).forEach(c=>{ mOthers[m] += state.data.others_expenses[c][m]; });
        Object.keys(state.data.finance_expenses).forEach(c=>{ mFinance[m] += state.data.finance_expenses[c][m]; });
        Object.keys(state.data.tax_expenses).forEach(c=>{ mTax[m] += state.data.tax_expenses[c][m]; });
        Object.keys(state.data.corp_events).forEach(r=>{ mCorpEvent[m] += state.data.corp_events[r].monthly[m]; });
        state.data.fixed_assets.forEach(r=>{ if(r.month==m) mCapex[m]+=r.qty*r.price; });
    }

    // ── Annual sums ───────────────────────────────────────────────────────
    const sum = arr => arr.reduce((a,b)=>a+b,0);
    const bgt27 = {
        units:   sum(mUnits),
        sqm:     sum(mSqm),
        revenue: sum(mRevenue),
        devland: sum(mDevLand),
        salesComm: sum(mSalesInhouse) + sum(mSalesAgent),
        progSales: sum(mSalesProgram),
        marketing: sum(mMarketingATL) + sum(mMarketingBTL),
        employee:  sum(mEmployee),
        ga:        sum(mGA),
        others:    sum(mOthers),
        finance:   sum(mFinance),
        tax:       sum(mTax),
        corpEvent: sum(mCorpEvent),
        capex:     sum(mCapex),
    };
    bgt27.totalProjCost   = bgt27.devland;
    bgt27.totalSalesMkt   = bgt27.salesComm + bgt27.progSales + bgt27.marketing;
    bgt27.totalEmpOps     = bgt27.employee + bgt27.ga + bgt27.others + bgt27.finance + bgt27.tax + bgt27.corpEvent;
    bgt27.totalAllCost    = bgt27.totalProjCost + bgt27.totalSalesMkt + bgt27.totalEmpOps + bgt27.capex;

    // ── Section header helper ─────────────────────────────────────────────
    const secHdr = (label, colspan=10) =>
        `<tr class="row-group-header"><td colspan="${colspan}" style="font-size:0.85rem;letter-spacing:0.05em;">${label}</td></tr>`;

    const mainHdr = (label) =>
        `<tr class="row-grand-total" style="font-size:0.82rem;background:rgba(139,92,246,0.25)!important">
            <td colspan="10" style="font-weight:800;letter-spacing:0.04em;">${label}</td>
        </tr>`;

    // ── Row builder: Description | bgt2026 | act2026 | real2026 | bgt2027 | diff1 | diff2
    const row = (label, key, b27val, indent=false) => {
        const b26 = g26(key+'_b26');
        const a26 = g26(key+'_a26');
        const r26 = g26(key+'_r26');
        const labelCell = `<td style="padding-left:${indent?'28px':'10px'}">${label}</td>`;
        return `<tr>
            ${labelCell}
            ${inp26(key+'_b26')}
            ${inp26(key+'_a26')}
            ${inp26(key+'_r26')}
            ${ro(b27val)}
            ${diff(b26, b27val)}
            ${diff(a26, b27val)}
        </tr>`;
    };

    // ── Subtotal row (bold, read-only all) ───────────────────────────────
    const subtotal = (label, key, b27val) => {
        const b26 = g26(key+'_b26');
        const a26 = g26(key+'_a26');
        const r26 = g26(key+'_r26');
        return `<tr class="row-group-total">
            <td style="font-weight:700">${label}</td>
            <td class="cell-computed">${b26 ? Math.round(b26).toLocaleString('id-ID') : '-'}</td>
            <td class="cell-computed">${a26 ? Math.round(a26).toLocaleString('id-ID') : '-'}</td>
            <td class="cell-computed">${r26 ? Math.round(r26).toLocaleString('id-ID') : '-'}</td>
            <td class="cell-computed" style="font-weight:800;color:var(--accent-indigo)">${Math.round(b27val).toLocaleString('id-ID')}</td>
            ${diff(b26, b27val)}
            ${diff(a26, b27val)}
        </tr>`;
    };

    let html = `
        <thead>
            <tr>
                <th rowspan="2" style="min-width:220px">Description</th>
                <th style="background:rgba(59,130,246,0.2)">Budget 2026</th>
                <th style="background:rgba(16,185,129,0.2)">Actual 2026</th>
                <th style="background:rgba(245,158,11,0.2)">Budget Realization 2026</th>
                <th style="background:rgba(139,92,246,0.3)">Budget 2027</th>
                <th>B2026 vs B2027</th>
                <th>B2027 vs A2026</th>
            </tr>
            <tr>
                <th style="font-size:0.7rem;font-weight:400;background:rgba(59,130,246,0.1)">Manual Input</th>
                <th style="font-size:0.7rem;font-weight:400;background:rgba(16,185,129,0.1)">Manual Input</th>
                <th style="font-size:0.7rem;font-weight:400;background:rgba(245,158,11,0.1)">Manual Input</th>
                <th style="font-size:0.7rem;font-weight:400;background:rgba(139,92,246,0.2)">Auto from Modules</th>
                <th style="font-size:0.7rem;font-weight:400">∆ %</th>
                <th style="font-size:0.7rem;font-weight:400">∆ %</th>
            </tr>
        </thead>
        <tbody>
    `;

    // ── A. SALES ─────────────────────────────────────────────────────────
    html += mainHdr('A. TARGET MARKETING REVENUE');
    html += secHdr('Sales in SQM');
    state.data.target_revenue.forEach((r,i) => {
        const sqmSum = r.sqm.reduce((a,b)=>a+b,0);
        html += row(r.category || `Type ${i+1}`, `sqm_cat${i}`, sqmSum, true);
    });
    html += subtotal('TOTAL SALES in SQM', 'total_sqm', bgt27.sqm);

    html += secHdr('Marketing Revenue (Rp Bio)');
    state.data.target_revenue.forEach((r,i) => {
        const revSum = r.sqm.reduce((a,b,mi)=>a+b*r.price_sqm,0);
        html += row(r.category || `Type ${i+1}`, `rev_cat${i}`, revSum, true);
    });
    html += subtotal('TOTAL MARKETING REVENUE (Rp Bio)', 'total_rev', bgt27.revenue);

    // ── B. PROJECT COST ──────────────────────────────────────────────────
    html += mainHdr('B. DEVELOPMENT & OPERATIONAL COST');
    html += secHdr('Project Cost');
    html += row('Land Cost', 'land_cost', bgt27.devland, true);
    html += row('Hard Cost (Dev Construction)', 'hard_cost', 0, true);
    html += row('Soft Cost (Legal, Permits, Fees)', 'soft_cost', 0, true);
    html += subtotal('Total Project Cost (Rp Bio)', 'total_proj', bgt27.devland);

    // ── C. SALES & MARKETING ─────────────────────────────────────────────
    html += secHdr('Sales & Marketing Costs (Rp Bio)');
    html += row('Sales Commission (Inhouse + Agent)', 'sales_comm', bgt27.salesComm, true);
    html += row('Program Sales Subsidies', 'prog_sales', bgt27.progSales, true);
    html += row('Advertising & Promotions (ATL+BTL)', 'marketing', bgt27.marketing, true);
    html += subtotal('Total Sales & Marketing Costs (Rp Bio)', 'total_sales_mkt', bgt27.totalSalesMkt);

    // ── D. EMPLOYEE & OPERATIONAL ────────────────────────────────────────
    html += secHdr('Employee & Operational Expenses (Rp Bio)');
    html += row('Employee Expenses (Payroll)', 'employee', bgt27.employee, true);
    html += row('General & Administration (incl. Bistrip)', 'ga', bgt27.ga, true);
    html += row('Others Expenses', 'others', bgt27.others, true);
    html += row('Finance Expense (Interest Loan)', 'finance', bgt27.finance, true);
    html += row('Taxes', 'tax', bgt27.tax, true);
    html += row('Corporate Event & Exhibitions', 'corp_event', bgt27.corpEvent, true);
    html += subtotal('Total Employee & Operational (Rp Bio)', 'total_emp_ops', bgt27.totalEmpOps);

    // ── E. FIXED ASSETS ──────────────────────────────────────────────────
    html += secHdr('Capital Expenditure (Capex)');
    html += row('Purchases of Fixed Assets (Capex)', 'capex', bgt27.capex, true);
    html += subtotal('Total Purchase Fixed Assets (Rp Bio)', 'total_capex', bgt27.capex);

    // ── GRAND TOTAL ───────────────────────────────────────────────────────
    const tot26b = g26('total_b26'), tot26a = g26('total_a26'), tot26r = g26('total_r26');
    html += `
        <tr class="row-grand-total" style="background:rgba(139,92,246,0.3)!important;font-size:1rem;">
            <td style="font-weight:900">TOTAL ALL COST (Rp Bio)</td>
            <td class="cell-computed" style="font-weight:800">${tot26b ? Math.round(tot26b).toLocaleString('id-ID') : '-'}</td>
            <td class="cell-computed" style="font-weight:800">${tot26a ? Math.round(tot26a).toLocaleString('id-ID') : '-'}</td>
            <td class="cell-computed" style="font-weight:800">${tot26r ? Math.round(tot26r).toLocaleString('id-ID') : '-'}</td>
            <td class="cell-computed" style="font-weight:900;color:#a78bfa;font-size:1.05rem">${Math.round(bgt27.totalAllCost).toLocaleString('id-ID')}</td>
            ${diff(tot26b, bgt27.totalAllCost)}
            ${diff(tot26a, bgt27.totalAllCost)}
        </tr>
    `;

    html += '</tbody>';
    table.innerHTML = html;
}

function update2026(key, val) {
    if (!state.data.summary_2026) state.data.summary_2026 = {};
    state.data.summary_2026[key] = parseFloat(val) || 0;
    state.isDirty = true;
    updateSyncIndicator(false);
    renderSummaryBudgetTable();
}

// ----------------------------------------------------
// STATE CALCULATION CORE HELPERS
// ----------------------------------------------------
function getMonthlyTargetSales() {
    const monthlyTarget = Array(12).fill(0);
    state.data.target_revenue.forEach(row => {
        row.sqm.forEach((s, idx) => {
            monthlyTarget[idx] += s * row.price_sqm;
        });
    });
    return monthlyTarget;
}

function getCalculatedSummary() {
    let totalRevenueVal = 0;
    let totalUnitsSold = 0;
    
    state.data.target_revenue.forEach(row => {
        const unitsSum = row.units.reduce((a, b) => a + b, 0);
        const sqmSum = row.sqm.reduce((a, b) => a + b, 0);
        totalRevenueVal += sqmSum * row.price_sqm;
        totalUnitsSold += unitsSum;
    });
    
    let projectCostVal = 0;
    Object.keys(state.data.dev_land).forEach(row => {
        projectCostVal += state.data.dev_land[row].monthly.reduce((a, b) => a + b, 0);
    });
    
    let salesMarketingCostVal = 0;
    // Sales Cost Inhouse
    Object.keys(state.data.sales_cost.inhouse).filter(k => !k.startsWith('_')).forEach(k => {
        salesMarketingCostVal += state.data.sales_cost.inhouse[k].reduce((a,b)=>a+b,0);
    });
    // Sales Cost Agent
    Object.keys(state.data.sales_cost.agent).filter(k => !k.startsWith('_')).forEach(k => {
        salesMarketingCostVal += state.data.sales_cost.agent[k].reduce((a,b)=>a+b,0);
    });
    // Program Sales Subsidies
    Object.keys(state.data.program_sales).filter(k => !k.startsWith('_')).forEach(k => {
        salesMarketingCostVal += state.data.program_sales[k].reduce((a,b)=>a+b,0);
    });
    // Marketing Activity
    Object.keys(state.data.marketing_activity).forEach(k => {
        salesMarketingCostVal += state.data.marketing_activity[k].reduce((a,b)=>a+b,0);
    });
    
    let employeeCostVal = 0;
    Object.keys(state.data.payroll_expenses).forEach(code => {
        employeeCostVal += state.data.payroll_expenses[code].reduce((a,b)=>a+b,0);
    });
    state.data.hc_program.forEach(row => {
        employeeCostVal += row.qty * row.price;
    });
    
    let operatingCostVal = 0;
    // G&A
    Object.keys(state.data.ga_expenses).forEach(k => {
        operatingCostVal += state.data.ga_expenses[k].reduce((a,b)=>a+b,0);
    });
    // Business Trip
    state.data.business_trip.forEach(row => {
        const allowancesMap = {
            'Director': { 'Local': 1500000, 'Overseas': 2000000 },
            'Manager':  { 'Local': 900000,  'Overseas': 1200000 },
            'SPV':      { 'Local': 750000,  'Overseas': 1000000 },
            'Staff':    { 'Local': 600000,  'Overseas': 800000  }
        };
        const hotelRatesMap = {
            'Director': { 'Local': 1650000, 'Overseas': 2500000 },
            'Manager':  { 'Local': 750000,  'Overseas': 1200000 },
            'SPV':      { 'Local': 600000,  'Overseas': 1000000 },
            'Staff':    { 'Local': 500000,  'Overseas': 800000  }
        };
        const standardFlightsMap = { 'Local': 4000000, 'Overseas': 8000000 };
        const grade = row.grade || 'Staff';
        const dest  = row.destination || 'Local';
        const standardFlight = standardFlightsMap[dest] || 4000000;
        const hotelRate = (hotelRatesMap[grade] || hotelRatesMap['Staff'])[dest] || 500000;
        const allowRate = (allowancesMap[grade] || allowancesMap['Staff'])[dest] || 600000;
        operatingCostVal += standardFlight + (hotelRate * Math.max(0, row.duration - 1)) + (allowRate * row.duration);
    });
    // Others
    Object.keys(state.data.others_expenses).forEach(k => {
        operatingCostVal += state.data.others_expenses[k].reduce((a,b)=>a+b,0);
    });
    // Finance
    Object.keys(state.data.finance_expenses).forEach(k => {
        operatingCostVal += state.data.finance_expenses[k].reduce((a,b)=>a+b,0);
    });
    // Taxes
    Object.keys(state.data.tax_expenses).forEach(k => {
        operatingCostVal += state.data.tax_expenses[k].reduce((a,b)=>a+b,0);
    });
    // Corp Events
    Object.keys(state.data.corp_events).forEach(k => {
        operatingCostVal += state.data.corp_events[k].monthly.reduce((a,b)=>a+b,0);
    });
    
    let capexCostVal = 0;
    state.data.fixed_assets.forEach(row => {
        capexCostVal += row.qty * row.price;
    });
    
    const totalCostVal = projectCostVal + salesMarketingCostVal + employeeCostVal + operatingCostVal + capexCostVal;
    
    return {
        totalRevenueVal,
        totalUnitsSold,
        projectCostVal,
        salesMarketingCostVal,
        employeeCostVal,
        operatingCostVal,
        capexCostVal,
        totalCostVal
    };
}

// ----------------------------------------------------
// GOOGLE APPS SCRIPT SYNC & BACKEND CONNECTIVITY
// ----------------------------------------------------
async function triggerDataLoad() {
    if (!state.selectedCompany || !state.selectedProject) return;
    
    showToast('Loading budget data from server...', 'info');
    
    if (!state.gasUrl) {
        // Fallback to local storage mock data for demonstration
        showToast('No Google Apps Script backend URL linked. Loading local workspace mock.', 'amber');
        loadLocalMockData();
        state.isDirty = false;
        updateSyncIndicator(true);
        switchTab(getActiveTabId());
        return;
    }
    
    try {
        const url = `${state.gasUrl}?action=get&company=${encodeURIComponent(state.selectedCompany)}&project=${encodeURIComponent(state.selectedProject)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network error loading data');
        
        const resJson = await response.json();
        if (resJson.status === 'success' && resJson.data) {
            state.data = resJson.data;
            showToast('Budget data successfully synced from server.', 'emerald');
            state.isDirty = false;
            updateSyncIndicator(true);
        } else {
            // No data exists, default initialized structure
            state.data = getInitialDataStructure();
            initDefaultDynamicData();
            showToast('No existing budget found on sheet. Initialized clean budget template.', 'info');
            state.isDirty = false;
            updateSyncIndicator(true);
        }
        
        switchTab(getActiveTabId());
    } catch (err) {
        console.error("Data fetch error:", err);
        showToast('Error connecting to GAS backend URL. Loading local draft.', 'error');
        loadLocalMockData();
    }
}

async function triggerDataSave() {
    if (!state.selectedCompany || !state.selectedProject) return;
    
    showToast('Saving budget planning to database...', 'info');
    
    if (!state.gasUrl) {
        // Save to local storage for local testing
        saveLocalMockData();
        showToast('Saved local draft successfully (Link GAS backend for server database).', 'emerald');
        state.isDirty = false;
        updateSyncIndicator(true);
        return;
    }
    
    try {
        const payload = {
            action: 'save',
            company: state.selectedCompany,
            project: state.selectedProject,
            data: state.data
        };
        
        const response = await fetch(state.gasUrl, {
            method: 'POST',
            // Content-Type must be text/plain to avoid CORS preflight (GAS does not support OPTIONS)
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });
        
        const resJson = await response.json();
        if (resJson.status === 'success') {
            showToast('FY 2027 Budget successfully committed to Google Sheets.', 'emerald');
            state.isDirty = false;
            updateSyncIndicator(true);
        } else {
            throw new Error(resJson.message || 'Commit failed');
        }
    } catch (err) {
        console.error("Commit error:", err);
        showToast('Failed to save to Google Sheets. Saved local draft.', 'error');
        saveLocalMockData();
        updateSyncIndicator(false);
    }
}

// ---------------------------------------------------
// EXPORT TO XLSX
// ---------------------------------------------------
function exportBudget() {
    if (!state.selectedCompany || !state.selectedProject) {
        showToast('Select a company and project before exporting.', 'amber');
        return;
    }
    showToast('Building Excel file...', 'info');
    try {
        const wb = XLSX.utils.book_new();
        const d = state.data;
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const fs = (n) => Math.round(n).toLocaleString('id-ID');
        const fshort = (n) => 'Rp ' + (n/1000000000).toFixed(2) + ' Bio';

        // --- 1. Target Revenue ---
        (() => {
            const rows = [['Category','Stock Units','Stock Sqm','Price/sqm','Metric','Total 2027',...months]];
            d.target_revenue.forEach(r => {
                const uSum = r.units.reduce((a,b)=>a+b,0);
                const sSum = r.sqm.reduce((a,b)=>a+b,0);
                const vSum = sSum * r.price_sqm;
                rows.push([r.category,'','','','','','']);
                rows.push(['A. Unit Target',r.stock_units,'','','Units',uSum,...r.units]);
                rows.push(['B. Sqm Target','',r.stock_sqm,r.price_sqm,'Sqm',sSum,...r.sqm]);
                rows.push(['C. Sales Value','','','','Value',vSum,...r.sqm.map(s=>s*r.price_sqm)]);
            });
            // Totals
            const mU = Array(12).fill(0), mS = Array(12).fill(0), mV = Array(12).fill(0);
            d.target_revenue.forEach(r => {
                r.units.forEach((u,i)=>mU[i]+=u);
                r.sqm.forEach((s,i)=>{ mS[i]+=s; mV[i]+=s*r.price_sqm; });
            });
            const gU = mU.reduce((a,b)=>a+b,0), gS = mS.reduce((a,b)=>a+b,0), gV = mV.reduce((a,b)=>a+b,0);
            rows.push(['TOTAL UNITS','','','','Units',gU,...mU]);
            rows.push(['TOTAL SQM','','','','Sqm',gS,...mS]);
            rows.push(['TOTAL VALUE','','','','Rupiah',gV,...mV]);
            // YTD
            const yU=[],yS=[],yV=[];
            for(let m=0;m<12;m++){ yU[m]=(yU[m-1]||0)+mU[m]; yS[m]=(yS[m-1]||0)+mS[m]; yV[m]=(yV[m-1]||0)+mV[m]; }
            rows.push(['UNITS YTD','','','','Units',gU,...yU]);
            rows.push(['SQM YTD','','','','Sqm',gS,...yS]);
            rows.push(['VALUE YTD','','','','Rupiah',gV,...yV]);
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{wch:20},{wch:10},{wch:10},{wch:10},{wch:8},{wch:14},...Array(12).fill({wch:12})];
            XLSX.utils.book_append_sheet(wb, ws, 'Target Revenue');
        })();

        // --- 2. Sales Cost ---
        (() => {
            const rows = [['Cost Component','Total 2027',...months]];
            const mT = Array(12).fill(0);
            ['inhouse','agent'].forEach(type => {
                rows.push([type.toUpperCase() + ' SALES','','','','','','','','','','','','','']);
                const typeKeys = Object.keys(d.sales_cost[type]).filter(k => !k.startsWith('_')).sort((a,b) => {
                    const order = ['closing_fee','or','komisi','reward'];
                    return (order.indexOf(a) !== -1 ? order.indexOf(a) : 99) - (order.indexOf(b) !== -1 ? order.indexOf(b) : 99);
                });
                typeKeys.forEach(k => {
                    const vals = d.sales_cost[type][k];
                    const sum = vals.reduce((a,b)=>a+b,0);
                    vals.forEach((v,mi)=>mT[mi]+=v);
                    const label = (d.sales_cost[type]._rowLabels && d.sales_cost[type]._rowLabels[k]) || k;
                    rows.push([label,sum,...vals]);
                });
            });
            const gSum = mT.reduce((a,b)=>a+b,0);
            rows.push(['TOTAL SALES COST',gSum,...mT]);
            const ytd=[]; for(let m=0;m<12;m++) ytd[m]=(ytd[m-1]||0)+mT[m];
            rows.push(['SALES COST YTD',gSum,...ytd]);
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{wch:22},{wch:14},...Array(12).fill({wch:12})];
            XLSX.utils.book_append_sheet(wb, ws, 'Sales Cost');
        })();

        // --- 3. Program Sales ---
        (() => {
            const progKeys = Object.keys(d.program_sales).filter(k => !k.startsWith('_')).sort((a,b) => {
                const order = ['booking_fee_subsidy','dp_subsidy','angsuran_subsidy','akad_subsidy','rentback','cashback_patungan'];
                return (order.indexOf(a) !== -1 ? order.indexOf(a) : 99) - (order.indexOf(b) !== -1 ? order.indexOf(b) : 99);
            });
            const rows = [['Program Component','Total 2027',...months]];
            const mT = Array(12).fill(0);
            progKeys.forEach(k => {
                const vals = d.program_sales[k];
                const sum = vals.reduce((a,b)=>a+b,0);
                vals.forEach((v,mi)=>mT[mi]+=v);
                const label = (d.program_sales._rowLabels && d.program_sales._rowLabels[k]) || k;
                rows.push([label,sum,...vals]);
            });
            const gSum = mT.reduce((a,b)=>a+b,0);
            rows.push(['TOTAL PROGRAM SALES',gSum,...mT]);
            const ytd=[]; for(let m=0;m<12;m++) ytd[m]=(ytd[m-1]||0)+mT[m];
            rows.push(['PROGRAM SALES YTD',gSum,...ytd]);
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{wch:24},{wch:14},...Array(12).fill({wch:12})];
            XLSX.utils.book_append_sheet(wb, ws, 'Program Sales');
        })();

        // --- 4. Marketing ---
        (() => {
            const rows = [['Activity','Classification','Total Budget',...months]];
            const mT = Array(12).fill(0);
            (state.templates.marketing||[]).forEach(item => {
                if (item.type === 'input') {
                    const vals = d.marketing_activity[item.row] || Array(12).fill(0);
                    const sum = vals.reduce((a,b)=>a+b,0);
                    vals.forEach((v,mi)=>mT[mi]+=v);
                    const cls = item.classification || '';
                    rows.push([item.name || '',cls,sum,...vals]);
                } else {
                    rows.push([(item.name || item.row || ''),'','','','','','','','','','','','','']);
                }
            });
            const gSum = mT.reduce((a,b)=>a+b,0);
            rows.push(['TOTAL MARKETING',gSum,...mT]);
            const ytd=[]; for(let m=0;m<12;m++) ytd[m]=(ytd[m-1]||0)+mT[m];
            rows.push(['MARKETING YTD',gSum,...ytd]);
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{wch:40},{wch:18},{wch:14},...Array(12).fill({wch:12})];
            XLSX.utils.book_append_sheet(wb, ws, 'Marketing');
        })();

        // --- 5. Dev & Land ---
        (() => {
            const rows = [['No','Category','SQM','Cost/sqm','RAB/SPK','Realisasi','Best Est','% Real','Total Budget',...months]];
            const mT = Array(12).fill(0);
            (state.templates.dev_land||[]).forEach(item => {
                if (item.num && item.num.includes('.')) {
                    const dr = d.dev_land[item.row] || {sqm:0,cost_sqm:0,rab_spk:0,realisasi:0,best_est:0,monthly:Array(12).fill(0)};
                    const totalEst = dr.realisasi + dr.best_est;
                    const pct = dr.rab_spk > 0 ? (totalEst/dr.rab_spk) : 0;
                    const bSum = dr.monthly.reduce((a,b)=>a+b,0);
                    dr.monthly.forEach((v,mi)=>mT[mi]+=v);
                    rows.push([item.num,item.subcat||item.cat,dr.sqm,dr.cost_sqm,dr.rab_spk,dr.realisasi,dr.best_est,(pct*100).toFixed(1)+'%',bSum,...dr.monthly]);
                } else {
                    rows.push([item.num||'',item.cat||'','','','','','','','',...Array(12).fill('')]);
                }
            });
            const gSum = mT.reduce((a,b)=>a+b,0);
            rows.push(['TOTAL DEV & LAND','','','','','','','',gSum,...mT]);
            const ytd=[]; for(let m=0;m<12;m++) ytd[m]=(ytd[m-1]||0)+mT[m];
            rows.push(['DEV & LAND YTD','','','','','','','',gSum,...ytd]);
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{wch:6},{wch:24},{wch:8},{wch:10},{wch:14},{wch:14},{wch:14},{wch:8},{wch:14},...Array(12).fill({wch:12})];
            XLSX.utils.book_append_sheet(wb, ws, 'Dev & Land');
        })();

        // --- 6. Payroll ---
        (() => {
            const payrollKeys = Object.keys(d.payroll_expenses).sort();
            const rows = [['Account ID','Payroll Component','Total 2027',...months]];
            const mT = Array(12).fill(0);
            payrollKeys.forEach(code => {
                const vals = d.payroll_expenses[code];
                const sum = vals.reduce((a,b)=>a+b,0);
                vals.forEach((v,mi)=>mT[mi]+=v);
                const tmplItem = (state.templates.payroll||[]).find(t => t.code === code);
                const label = tmplItem ? tmplItem.name : code;
                rows.push([code, label, sum, ...vals]);
            });
            const gSum = mT.reduce((a,b)=>a+b,0);
            rows.push(['','TOTAL PAYROLL',gSum,...mT]);
            const ytd=[]; for(let m=0;m<12;m++) ytd[m]=(ytd[m-1]||0)+mT[m];
            rows.push(['','PAYROLL YTD',gSum,...ytd]);
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{wch:12},{wch:42},{wch:14},...Array(12).fill({wch:12})];
            XLSX.utils.book_append_sheet(wb, ws, 'Payroll');
        })();

        // --- 7. HC Program ---
        (() => {
            const rows = [['Activity','Institution','Category','Qty','Price/Unit','Total','Month']];
            (d.hc_program||[]).forEach(r => {
                rows.push([r.topic,r.institution,r.category,r.qty,r.price,r.qty*r.price,months[r.month]]);
            });
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{wch:30},{wch:22},{wch:22},{wch:6},{wch:12},{wch:16},{wch:8}];
            XLSX.utils.book_append_sheet(wb, ws, 'HC Program');
        })();

        // --- 8. Expenses (GA, Others, Finance, Tax) ---
        const expTypes = [
            {key:'ga', label:'G&A Expenses', templates: state.templates.ga, data: d.ga_expenses},
            {key:'others', label:'Others Expenses', templates: state.templates.others, data: d.others_expenses},
            {key:'finance', label:'Finance Expenses', templates: state.templates.finance, data: d.finance_expenses},
            {key:'tax', label:'Tax Expenses', templates: state.templates.tax, data: d.tax_expenses}
        ];
        expTypes.forEach(({key,label,templates:tpl,data:src}) => {
            const rows = [['Account ID','Description','Total Budget',...months]];
            const mT = Array(12).fill(0);
            (tpl||[]).forEach(acc => {
                const vals = src[acc.code] || Array(12).fill(0);
                const sum = vals.reduce((a,b)=>a+b,0);
                vals.forEach((v,mi)=>mT[mi]+=v);
                rows.push([acc.code,acc.name,sum,...vals]);
            });
            const gSum = mT.reduce((a,b)=>a+b,0);
            rows.push(['TOTAL',gSum,...mT]);
            const ytd=[]; for(let m=0;m<12;m++) ytd[m]=(ytd[m-1]||0)+mT[m];
            rows.push(['YTD',gSum,...ytd]);
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{wch:14},{wch:42},{wch:14},...Array(12).fill({wch:12})];
            XLSX.utils.book_append_sheet(wb, ws, label);
        });

        // --- 9. Corporate Event ---
        (() => {
            const rows = [['Activity','Classification','Qty','Price/Unit','Subtotal','Total Budget',...months]];
            const mT = Array(12).fill(0);
            (state.templates.corp_event||[]).forEach(item => {
                if (item.type === 'input') {
                    const dr = d.corp_events[item.row] || {qty:0,price_unit:0,monthly:Array(12).fill(0)};
                    const sub = dr.qty * dr.price_unit;
                    const sum = dr.monthly.reduce((a,b)=>a+b,0);
                    dr.monthly.forEach((v,mi)=>mT[mi]+=v);
                    rows.push([item.activity,item.classification||'',dr.qty,dr.price_unit,sub,sum,...dr.monthly]);
                } else {
                    rows.push([item.activity||'','','','','','',...Array(12).fill('')]);
                }
            });
            const gSum = mT.reduce((a,b)=>a+b,0);
            rows.push(['TOTAL CORPORATE EVENT','','','','',gSum,...mT]);
            const ytd=[]; for(let m=0;m<12;m++) ytd[m]=(ytd[m-1]||0)+mT[m];
            rows.push(['CORPORATE EVENT YTD','','','','',gSum,...ytd]);
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{wch:36},{wch:16},{wch:6},{wch:12},{wch:14},{wch:14},...Array(12).fill({wch:12})];
            XLSX.utils.book_append_sheet(wb, ws, 'Corporate Event');
        })();

        // --- 10. Fixed Assets ---
        (() => {
            const rows = [['Division','Category','Description','Type','Qty','Price/Unit','Total','Month','Justification']];
            (d.fixed_assets||[]).forEach(r => {
                rows.push([r.division,r.category,r.desc,r.new_replace,r.qty,r.price,r.qty*r.price,months[r.month],r.justification]);
            });
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{wch:14},{wch:26},{wch:30},{wch:10},{wch:6},{wch:14},{wch:18},{wch:8},{wch:14}];
            XLSX.utils.book_append_sheet(wb, ws, 'Fixed Assets');
        })();

        // --- 11. Business Trip ---
        (() => {
            const rows = [['Employee','Division','Grade','Dest.','City','Month','Days','Flight','Hotel/Night','Allowance/Day','Total']];
            const allowances = {'Director':{'Local':1500000,'Overseas':2000000},'Manager':{'Local':900000,'Overseas':1200000},'SPV':{'Local':750000,'Overseas':1000000},'Staff':{'Local':600000,'Overseas':800000}};
            const hotelRates = {'Director':{'Local':1650000,'Overseas':2500000},'Manager':{'Local':750000,'Overseas':1200000},'SPV':{'Local':600000,'Overseas':1000000},'Staff':{'Local':500000,'Overseas':800000}};
            const stdFlights = {'Local':4000000,'Overseas':8000000};
            (d.business_trip||[]).forEach(r => {
                const ticket = (r.ticket_price !== undefined && r.ticket_price !== null) ? r.ticket_price : (stdFlights[r.destination]||4000000);
                const hotel = (hotelRates[r.grade]||hotelRates.Staff)[r.destination]||500000;
                const allow = (allowances[r.grade]||allowances.Staff)[r.destination]||600000;
                const total = ticket + (hotel * Math.max(0,r.duration-1)) + (allow * r.duration);
                rows.push([r.employee,r.division,r.grade,r.destination,r.city,months[r.month],r.duration,ticket,hotel,allow,total]);
            });
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{wch:18},{wch:14},{wch:10},{wch:10},{wch:14},{wch:8},{wch:8},{wch:14},{wch:14},{wch:14},{wch:18}];
            XLSX.utils.book_append_sheet(wb, ws, 'Business Trip');
        })();

        // --- 12. Summary Budget (Original Template Format) ---
        (() => {
            const s26 = d.summary_2026 || {};
            const g26 = (k) => parseFloat(s26[k] || 0);

            // Monthly trackers
            const mRev=Array(12).fill(0), mUnits=Array(12).fill(0), mSqm=Array(12).fill(0);
            d.target_revenue.forEach(r => {
                r.sqm.forEach((s,m)=>{ mRev[m]+=s*r.price_sqm; mSqm[m]+=s; });
                r.units.forEach((u,m)=>mUnits[m]+=u);
            });
            const sinhouse=[],sagent=[],sprogram=[],matl=[],mbtl=[],mdev=Array(12).fill(0),memp=Array(12).fill(0),mga=Array(12).fill(0);
            const mother=Array(12).fill(0),mfin=Array(12).fill(0),mtax=Array(12).fill(0),mcorp=Array(12).fill(0),mcapex=Array(12).fill(0);
            for(let m=0;m<12;m++){
                sinhouse[m]=d.sales_cost.inhouse.closing_fee[m]+d.sales_cost.inhouse.or[m]+d.sales_cost.inhouse.komisi[m]+d.sales_cost.inhouse.reward[m];
                sagent[m]=d.sales_cost.agent.closing_fee[m]+d.sales_cost.agent.or[m]+d.sales_cost.agent.komisi[m]+d.sales_cost.agent.reward[m];
                Object.keys(d.program_sales).forEach(k=>sprogram[m]+=d.program_sales[k][m]);
                (state.templates.marketing||[]).forEach(item=>{
                    if(item.type==='input'){ const v=d.marketing_activity[item.row]?d.marketing_activity[item.row][m]:0; if(item.row<46)matl[m]+=v; else mbtl[m]+=v; }
                });
                Object.keys(d.dev_land).forEach(row=>mdev[m]+=d.dev_land[row].monthly[m]);
                memp[m]=Object.keys(d.payroll_expenses).reduce((sum,code)=>sum+d.payroll_expenses[code][m],0);
                (d.hc_program||[]).forEach(r=>{if(r.month==m)memp[m]+=r.qty*r.price;});
                Object.keys(d.ga_expenses).forEach(code=>mga[m]+=d.ga_expenses[code][m]);
                (d.business_trip||[]).forEach(r=>{
                    if(r.month==m){
                        const amap={'Director':{'Local':1500000,'Overseas':2000000},'Manager':{'Local':900000,'Overseas':1200000},'SPV':{'Local':750000,'Overseas':1000000},'Staff':{'Local':600000,'Overseas':800000}};
                        const hmap={'Director':{'Local':1650000,'Overseas':2500000},'Manager':{'Local':750000,'Overseas':1200000},'SPV':{'Local':600000,'Overseas':1000000},'Staff':{'Local':500000,'Overseas':800000}};
                        const sflights={'Local':4000000,'Overseas':8000000};
                        const grade=r.grade||'Staff',dest=r.destination||'Local';
                        const ticket=(r.ticket_price!=null)?r.ticket_price:(sflights[dest]||4000000);
                        const hotel=(hmap[grade]||hmap.Staff)[dest]||500000;
                        const allow=(amap[grade]||amap.Staff)[dest]||600000;
                        mga[m]+=ticket+(hotel*Math.max(0,r.duration-1))+(allow*r.duration);
                    }
                });
                Object.keys(d.others_expenses).forEach(code=>mother[m]+=d.others_expenses[code][m]);
                Object.keys(d.finance_expenses).forEach(code=>mfin[m]+=d.finance_expenses[code][m]);
                Object.keys(d.tax_expenses).forEach(code=>mtax[m]+=d.tax_expenses[code][m]);
                Object.keys(d.corp_events).forEach(row=>mcorp[m]+=d.corp_events[row].monthly[m]);
                (d.fixed_assets||[]).forEach(r=>{if(r.month==m)mcapex[m]+=r.qty*r.price;});
            }

            const sum = arr => arr.reduce((a,b)=>a+b,0);
            const b27 = {
                sqm: sum(mSqm),
                revenue: sum(mRev),
                devland: sum(mdev),
                salesComm: sum(sinhouse) + sum(sagent),
                progSales: sum(sprogram),
                marketing: sum(matl) + sum(mbtl),
                employee: sum(memp),
                ga: sum(mga),
                others: sum(mother),
                finance: sum(mfin),
                tax: sum(mtax),
                corpEvent: sum(mcorp),
                capex: sum(mcapex)
            };
            b27.totalProj = b27.devland;
            b27.totalSalesMkt = b27.salesComm + b27.progSales + b27.marketing;
            b27.totalEmpOps = b27.employee + b27.ga + b27.others + b27.finance + b27.tax + b27.corpEvent;
            b27.totalAllCost = b27.totalProj + b27.totalSalesMkt + b27.totalEmpOps + b27.capex;

            const calcPct = (b26, b27val) => b26 ? ((b27val - b26) / Math.abs(b26) * 100).toFixed(1) + '%' : '-';

            const rows = [
                ['Description', 'BUDGET 2026', 'ACTUAL 2026', 'Budget Realization 2026', 'BUDGET 2027', 'B2026 vs B2027', 'B2027 vs A2026'],
                ['A. TARGET MARKETING REVENUE', '', '', '', '', '', ''],
                ['Sales in SQM', '', '', '', '', '', '']
            ];

            d.target_revenue.forEach((r, i) => {
                const sqmSum = r.sqm.reduce((a,b)=>a+b,0);
                const k = `sqm_cat${i}`;
                rows.push([`  ${r.category || 'Type '+(i+1)}`, g26(k+'_b26'), g26(k+'_a26'), g26(k+'_r26'), sqmSum, calcPct(g26(k+'_b26'), sqmSum), calcPct(g26(k+'_a26'), sqmSum)]);
            });
            rows.push(['TOTAL SALES in SQM', g26('total_sqm_b26'), g26('total_sqm_a26'), g26('total_sqm_r26'), b27.sqm, calcPct(g26('total_sqm_b26'), b27.sqm), calcPct(g26('total_sqm_a26'), b27.sqm)]);

            rows.push(['Marketing Revenue (Rp)', '', '', '', '', '', '']);
            d.target_revenue.forEach((r, i) => {
                const revSum = r.sqm.reduce((a,b,mi)=>a+b*r.price_sqm,0);
                const k = `rev_cat${i}`;
                rows.push([`  ${r.category || 'Type '+(i+1)}`, g26(k+'_b26'), g26(k+'_a26'), g26(k+'_r26'), revSum, calcPct(g26(k+'_b26'), revSum), calcPct(g26(k+'_a26'), revSum)]);
            });
            rows.push(['TOTAL MARKETING REVENUE (Rp)', g26('total_rev_b26'), g26('total_rev_a26'), g26('total_rev_r26'), b27.revenue, calcPct(g26('total_rev_b26'), b27.revenue), calcPct(g26('total_rev_a26'), b27.revenue)]);

            rows.push(['B. DEVELOPMENT & OPERATIONAL COST', '', '', '', '', '', '']);
            rows.push(['Total Project Cost (Land & Dev)', g26('total_proj_b26'), g26('total_proj_a26'), g26('total_proj_r26'), b27.devland, calcPct(g26('total_proj_b26'), b27.devland), calcPct(g26('total_proj_a26'), b27.devland)]);
            rows.push(['Total Sales & Marketing Costs', g26('total_sales_mkt_b26'), g26('total_sales_mkt_a26'), g26('total_sales_mkt_r26'), b27.totalSalesMkt, calcPct(g26('total_sales_mkt_b26'), b27.totalSalesMkt), calcPct(g26('total_sales_mkt_a26'), b27.totalSalesMkt)]);
            rows.push(['Total Employee & Operational Expenses', g26('total_emp_ops_b26'), g26('total_emp_ops_a26'), g26('total_emp_ops_r26'), b27.totalEmpOps, calcPct(g26('total_emp_ops_b26'), b27.totalEmpOps), calcPct(g26('total_emp_ops_a26'), b27.totalEmpOps)]);
            rows.push(['Total Purchase Fixed Assets (Capex)', g26('total_capex_b26'), g26('total_capex_a26'), g26('total_capex_r26'), b27.capex, calcPct(g26('total_capex_b26'), b27.capex), calcPct(g26('total_capex_a26'), b27.capex)]);
            rows.push(['TOTAL ALL COST (Rp)', g26('total_b26'), g26('total_a26'), g26('total_r26'), b27.totalAllCost, calcPct(g26('total_b26'), b27.totalAllCost), calcPct(g26('total_a26'), b27.totalAllCost)]);

            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{wch:38},{wch:18},{wch:18},{wch:22},{wch:18},{wch:16},{wch:16}];
            XLSX.utils.book_append_sheet(wb, ws, 'SUMMARY BUDGET');
        })();

        // Write file
        const wbout = XLSX.write(wb, {bookType:'xlsx', type:'array'});
        const blob = new Blob([wbout], {type:'application/octet-stream'});
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        const fname = `Budget_${state.selectedCompany}_${state.selectedProject}_FY2027.xlsx`;
        link.download = fname.replace(/[^a-zA-Z0-9_\-\.]/g,'_');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        showToast('Excel file exported successfully!', 'emerald');
    } catch (err) {
        console.error(err);
        showToast('Export error: ' + err.message, 'error');
    }
}

// Local mock data handlers
function loadLocalMockData() {
    const key = `draft_${state.selectedCompany}_${state.selectedProject}`;
    const stored = localStorage.getItem(key);
    if (stored) {
        state.data = JSON.parse(stored);
    } else {
        state.data = getInitialDataStructure();
        initDefaultDynamicData();
    }
}

function saveLocalMockData() {
    const key = `draft_${state.selectedCompany}_${state.selectedProject}`;
    localStorage.setItem(key, JSON.stringify(state.data));
}

// Visual helpers
function getActiveTabId() {
    const active = document.querySelector('.sidebar-nav .nav-item.active');
    return active ? active.getAttribute('data-tab') : 'dashboard';
}

function updateSyncIndicator(synced) {
    const dot = document.querySelector('.indicator-dot');
    const text = document.getElementById('sync-status');
    
    if (synced) {
        dot.className = 'indicator-dot synced';
        text.innerText = 'Synced';
    } else {
        dot.className = 'indicator-dot unsynced';
        text.innerText = 'Unsaved Draft';
    }
}

function showToast(message, type = 'emerald') {
    // Remove existing toast
    const existing = document.querySelector('.toast-msg');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `toast-msg show ${type === 'error' ? 'error' : ''}`;
    
    let icon = 'info';
    if (type === 'emerald') icon = 'check-circle';
    else if (type === 'error') icon = 'alert-triangle';
    else if (type === 'amber') icon = 'alert-circle';
    
    toast.innerHTML = `<i data-lucide="${icon}"></i><span>${message}</span>`;
    document.body.appendChild(toast);
    
    refreshIcons();
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Modal Actions
function showGasConfigModal() {
    const modal = document.getElementById('gas-modal');
    modal.style.display = 'flex';
    document.getElementById('gas-url-input').value = state.gasUrl;
}

function hideGasConfigModal() {
    document.getElementById('gas-modal').style.display = 'none';
}

function saveGasConfigLink() {
    const url = document.getElementById('gas-url-input').value.trim();
    state.gasUrl = url;
    localStorage.setItem('gas_url', url);
    hideGasConfigModal();
    showToast('GAS Web App URL linked successfully.', 'emerald');
    triggerDataLoad();
}

// ----------------------------------------------------
// NIK AUTHENTICATION & PERMISSIONS SYSTEM
// ----------------------------------------------------
function showNikLoginModal() {
    document.getElementById('nik-login-modal').style.display = 'flex';
}

function hideNikLoginModal() {
    document.getElementById('nik-login-modal').style.display = 'none';
}

async function handleNikLoginSubmit(e) {
    e.preventDefault();
    const nikInput = document.getElementById('nik-input').value.trim();
    if (!nikInput) return;
    
    showToast('Verifying employee NIK...', 'info');
    
    if (state.gasUrl) {
        try {
            const url = `${state.gasUrl}?action=loginNik&nik=${encodeURIComponent(nikInput)}`;
            const res = await fetch(url);
            const json = await res.json();
            
            if (json.status === 'success' && json.user) {
                setAuthenticatedUser(json.user);
            } else {
                showToast('Invalid NIK or not authorized for 2027 budget planner.', 'error');
            }
        } catch (err) {
            console.error(err);
            // Fallback for offline/local testing
            fallbackNikLogin(nikInput);
        }
    } else {
        // Local fallback when backend URL is not yet connected
        fallbackNikLogin(nikInput);
    }
}

function fallbackNikLogin(nikInput) {
    const user = {
        employeeId: nikInput,
        name: nikInput.toLowerCase() === '1001' ? 'Administrator' : `Employee (${nikInput})`,
        allowedProjects: 'ALL',
        allowedCompanies: 'ALL',
        role: nikInput.toLowerCase() === '1001' ? 'Admin' : 'User'
    };
    setAuthenticatedUser(user);
}

function setAuthenticatedUser(user) {
    state.currentUser = user;
    sessionStorage.setItem('current_user', JSON.stringify(user));
    
    document.getElementById('user-display-name').innerText = user.name || user.employeeId;
    document.getElementById('user-display-nik').innerText = `NIK: ${user.employeeId} (${user.role})`;
    
    hideNikLoginModal();
    showToast(`Welcome ${user.name}! NIK verified.`, 'emerald');
    
    // Show/hide admin tab based on role
    const adminNav = document.getElementById('nav-nik-mgmt');
    if (adminNav) {
        adminNav.style.display = (user.role === 'Admin' || user.allowedProjects === 'ALL') ? 'flex' : 'none';
    }
    
    initDropdowns();
    triggerDataLoad();
}

function handleNikLogout() {
    state.currentUser = null;
    sessionStorage.removeItem('current_user');
    document.getElementById('user-display-name').innerText = 'Not Signed In';
    document.getElementById('user-display-nik').innerText = 'NIK: -';
    showToast('Signed out successfully.', 'info');
    showNikLoginModal();
}

// ----------------------------------------------------
// NIK MANAGEMENT UI (ADMIN)
// ----------------------------------------------------
async function renderNikManagementTable() {
    const tbody = document.getElementById('nik-list-body');
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-secondary);">Loading employee access list...</td></tr>`;
    
    if (state.gasUrl) {
        try {
            const res = await fetch(`${state.gasUrl}?action=listEmployees`);
            const json = await res.json();
            if (json.status === 'success' && Array.isArray(json.data)) {
                state.nikList = json.data;
            }
        } catch (err) {
            console.error(err);
        }
    }
    
    if (!state.nikList || state.nikList.length === 0) {
        state.nikList = [
            { employeeId: '1001', name: 'Administrator', allowedProjects: 'ALL', allowedCompanies: 'ALL', role: 'Admin' }
        ];
    }
    
    tbody.innerHTML = state.nikList.map((emp, idx) => `
        <tr>
            <td><strong style="font-family:monospace;">${emp.employeeId}</strong></td>
            <td>${emp.name || '-'}</td>
            <td><span class="badge ${emp.allowedProjects === 'ALL' ? 'badge-emerald' : 'badge-purple'}">${emp.allowedProjects}</span></td>
            <td><span class="badge ${emp.allowedCompanies === 'ALL' ? 'badge-emerald' : 'badge-indigo'}">${emp.allowedCompanies}</span></td>
            <td><span class="badge ${emp.role === 'Admin' ? 'badge-amber' : ''}">${emp.role}</span></td>
            <td class="action-cell">
                <button class="btn-delete" onclick="deleteNikPermission('${emp.employeeId}')" title="Revoke NIK Access"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>
    `).join('');
    
    refreshIcons();
}

function showNikEditModal() {
    const container = document.getElementById('nik-project-checkboxes');
    container.innerHTML = state.metadata.projects.map(p => `
        <label class="checkbox-label" style="display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer;">
            <input type="checkbox" name="nik-project" value="${p}" checked>
            <span>${p}</span>
        </label>
    `).join('');
    
    document.getElementById('edit-nik-id').value = '';
    document.getElementById('edit-nik-name').value = '';
    document.getElementById('nik-edit-modal').style.display = 'flex';
}

function hideNikEditModal() {
    document.getElementById('nik-edit-modal').style.display = 'none';
}

async function saveNikPermissions() {
    const empId = document.getElementById('edit-nik-id').value.trim();
    const name = document.getElementById('edit-nik-name').value.trim();
    const role = document.getElementById('edit-nik-role').value;
    
    if (!empId) {
        showToast('Employee NIK ID is required.', 'amber');
        return;
    }
    
    const checkboxes = document.querySelectorAll('input[name="nik-project"]:checked');
    const selectedProjects = Array.from(checkboxes).map(cb => cb.value);
    const allowedProjsStr = (selectedProjects.length === state.metadata.projects.length || selectedProjects.length === 0) ? 'ALL' : selectedProjects.join(',');
    
    // Auto-map companies for selected projects
    let allowedComps = [];
    selectedProjects.forEach(proj => {
        const comps = (state.metadata.projectCompanyMapping || {})[proj] || [];
        comps.forEach(c => { if (!allowedComps.includes(c)) allowedComps.push(c); });
    });
    const allowedCompsStr = (allowedComps.length === 0 || allowedProjsStr === 'ALL') ? 'ALL' : allowedComps.join(',');
    
    const payload = {
        action: 'addEmployee',
        employeeId: empId,
        name: name || 'Employee',
        allowedProjects: allowedProjsStr,
        allowedCompanies: allowedCompsStr,
        role: role
    };
    
    showToast('Saving NIK permissions...', 'info');
    
    if (state.gasUrl) {
        try {
            await fetch(state.gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
            showToast('NIK permissions saved successfully to Google Sheets.', 'emerald');
        } catch (err) {
            console.error(err);
            showToast('Saved NIK locally.', 'amber');
        }
    } else {
        showToast('Saved NIK access rules.', 'emerald');
    }
    
    // Update local state
    const existingIdx = state.nikList.findIndex(e => e.employeeId === empId);
    const newRecord = { employeeId: empId, name: name || 'Employee', allowedProjects: allowedProjsStr, allowedCompanies: allowedCompsStr, role: role };
    if (existingIdx >= 0) state.nikList[existingIdx] = newRecord;
    else state.nikList.push(newRecord);
    
    hideNikEditModal();
    renderNikManagementTable();
}

async function deleteNikPermission(empId) {
    if (!confirm(`Revoke NIK access for ${empId}?`)) return;
    
    showToast('Revoking NIK access...', 'info');
    if (state.gasUrl) {
        try {
            await fetch(state.gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'deleteEmployee', employeeId: empId }) });
        } catch (err) {
            console.error(err);
        }
    }
    
    state.nikList = state.nikList.filter(e => e.employeeId !== empId);
    showToast(`NIK access revoked for ${empId}.`, 'emerald');
    renderNikManagementTable();
}
