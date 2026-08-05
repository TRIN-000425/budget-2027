// FY 2027 Project Planned Budget Planner - Main JS Application
let state = {
    metadata: null,
    templates: null,
    selectedCompany: '',
    selectedProject: '',
    selectedDepartment: '',
    gasUrl: localStorage.getItem('gas_url') || 'https://script.google.com/macros/s/AKfycbxg0wEPqmGRFkoj-HDysUW6UV_HKzEZr1LrdgZ_8IBB9BgymAWEXFuvBzppls4Zpgk/exec',
    isDirty: false,
    currentUser: JSON.parse(sessionStorage.getItem('current_user_v2') || 'null'),
    nikList: [],
    departments: [],
    mockMode: false,
    realUser: null,
    data: getInitialDataStructure()
};

// Budget module keys & friendly labels (department access is set at this granularity)
const BUDGET_MODULES = [
    { key: 'target-revenue',       label: 'Target Revenue' },
    { key: 'sales-cost',           label: 'Sales & Program Cost' },
    { key: 'marketing-activity',   label: 'Marketing Activity' },
    { key: 'dev-land',             label: 'Dev & Land Cost' },
    { key: 'employee-hc',          label: 'Budget Payroll' },
    { key: 'ga-others',            label: 'G&A & Other Expenses' },
    { key: 'corp-event',           label: 'Corporate Event' },
    { key: 'fixed-assets',         label: 'Fixed Assets (Capex)' },
    { key: 'business-trip',        label: 'Business Trip' }
];

// Permission helpers
const isSuperAdmin = () => state.currentUser && state.currentUser.role === 'Admin';
const isDeptHead   = () => state.currentUser && state.currentUser.role === 'DeptHead';
const isFAT        = () => state.currentUser && state.currentUser.role === 'FAT';
const canManageUsers = () => state.currentUser && (isSuperAdmin() || isDeptHead());

function parseCsvList(str) {
    if (!str) return [];
    return String(str).split(',').map(s => s.trim()).filter(Boolean);
}

// Fetch with timeout so a hanging backend can never freeze the UI.
// GAS cold starts (first call after idle) can take 8-15s, so the default is generous.
async function fetchWithTimeout(url, options, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// Timeout aborts are an EXPECTED fallback path, not a real error
function isAbortError(err) {
    return err && (err.name === 'AbortError' || err.code === 20);
}

// GAS GET with cold-start resilience: retry once if the first attempt times out
async function fetchGasGet(url, timeoutMs = 15000) {
    try {
        return await fetchWithTimeout(url, {}, timeoutMs);
    } catch (err) {
        if (isAbortError(err)) {
            // First hit after deploy/idle is slow - retry once before giving up
            return await fetchWithTimeout(url, {}, timeoutMs);
        }
        throw err;
    }
}

// Effective projects a user may open:
// Admin -> ALL; User/DeptHead -> their assigned projects, capped by department scope
function getEffectiveAllowedProjects() {
    if (!state.currentUser) return 'ALL';
    if (isSuperAdmin()) return 'ALL';
    const userList = state.currentUser.allowedProjects && state.currentUser.allowedProjects !== 'ALL'
        ? parseCsvList(state.currentUser.allowedProjects) : null;
    const deptList = state.currentUser.deptAllowedProjects && state.currentUser.deptAllowedProjects !== 'ALL'
        ? parseCsvList(state.currentUser.deptAllowedProjects) : null;
    if (!userList) return deptList ? deptList : 'ALL';
    if (!deptList) return userList;
    return userList.filter(p => deptList.map(d => d.toLowerCase()).includes(p.toLowerCase()));
}

// Effective companies, derived the same way (capped by department scope)
function getEffectiveAllowedCompanies() {
    if (!state.currentUser) return 'ALL';
    if (isSuperAdmin()) return 'ALL';
    const userList = state.currentUser.allowedCompanies && state.currentUser.allowedCompanies !== 'ALL'
        ? parseCsvList(state.currentUser.allowedCompanies) : null;
    const deptList = state.currentUser.deptAllowedCompanies && state.currentUser.deptAllowedCompanies !== 'ALL'
        ? parseCsvList(state.currentUser.deptAllowedCompanies) : null;
    if (!userList) return deptList ? deptList : 'ALL';
    if (!deptList) return userList;
    return userList.filter(c => deptList.map(d => d.toLowerCase()).includes(c.toLowerCase()));
}

// Effective modules the current user may open (Admin = everything)
function getEffectiveAllowedModules() {
    if (!state.currentUser) return BUDGET_MODULES.map(m => m.key);
    if (isSuperAdmin()) return BUDGET_MODULES.map(m => m.key);
    if (state.currentUser.allowedModules && state.currentUser.allowedModules !== 'ALL') {
        return parseCsvList(state.currentUser.allowedModules);
    }
    return BUDGET_MODULES.map(m => m.key);
}

function isModuleAllowed(moduleKey) {
    return getEffectiveAllowedModules().includes(moduleKey);
}

// The department whose entries the current user reads/writes:
// Admin picks from the header selector; everyone else is locked to their own department
function getActiveDepartment() {
    if (!state.currentUser) return '';
    if (isSuperAdmin()) return state.selectedDepartment;
    return state.currentUser.department || '';
}

// Warn before discarding an unsaved draft when switching project/company/division
function confirmDiscardDraft() {
    if (!state.isDirty) return true;
    return confirm('You have unsaved changes in the current budget. Discard them and switch?');
}

// Whether a tab may be opened by the current user
function isTabAllowed(tabId) {
    if (!state.currentUser) return tabId === 'dashboard';
    if (isSuperAdmin()) return true;
    // FAT manager: consolidated all-departments summary is their only view
    if (isFAT()) return tabId === 'fat-summary';
    if (tabId === 'departments') return false;
    if (tabId === 'nik-management') return isDeptHead();
    if (tabId === 'dept-summary') return isDeptHead();
    if (tabId === 'fat-summary') return false;
    if (tabId === 'dashboard' || tabId === 'summary-budget') return true;
    const mod = BUDGET_MODULES.find(m => m.key === tabId);
    if (mod) return isModuleAllowed(tabId);
    return true;
}

// Landing tab when the active tab isn't allowed for the current role
function getDefaultTab() {
    if (isFAT()) return 'fat-summary';
    return 'dashboard';
}

// Show/hide sidebar items based on role + department module access
function applyModuleVisibility() {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
        const tabId = item.getAttribute('data-tab');
        item.style.display = isTabAllowed(tabId) ? 'flex' : 'none';
    });
    // Keep active tab valid
    const activeTab = getActiveTabId();
    if (!isTabAllowed(activeTab)) {
        switchTab(getDefaultTab());
    }
}

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

// HTML-escape user-controlled strings before they touch innerHTML / attribute values
// (prevents stored XSS via category names, descriptions, employee names, NIKs, etc.)
function esc(str) {
    return String(str === undefined || str === null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Count fields (units, sqm, qty, duration): non-negative integers only
function parseCount(v) {
    const n = Math.floor(parseFloat(v));
    return isNaN(n) || n < 0 ? 0 : n;
}

// Money fields (rupiah): whole numbers; negatives allowed (income lines in Others/Finance)
function parseMoney(v) {
    const n = Math.floor(parseFloat(v));
    return isNaN(n) ? 0 : n;
}

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
        ga_children: {}, // G&A hierarchy: code -> [{ id, name, monthly[12] }]; parent ga_expenses[code] = sum of children
        others_expenses: {},
        finance_expenses: {},
        tax_expenses: {},
        corp_events: {},
        fixed_assets: [],
        business_trip: [],
        summary_2026: {}
    };
}

function refreshIcons() {
    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

// Sidebar collapse / expand
let navTooltipEl = null;
function getNavTooltip() {
    if (!navTooltipEl) {
        navTooltipEl = document.createElement('div');
        navTooltipEl.className = 'nav-tooltip';
        document.body.appendChild(navTooltipEl);
    }
    return navTooltipEl;
}
function hideNavTooltip() {
    if (navTooltipEl) navTooltipEl.style.display = 'none';
}

// Floating tooltip for nav items, shown only while the sidebar is collapsed
function initNavTooltips() {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
        const span = item.querySelector('span');
        if (span && !item.getAttribute('data-tooltip')) {
            item.setAttribute('data-tooltip', span.textContent.trim());
        }
        item.addEventListener('mouseenter', () => {
            const sidebar = document.querySelector('.sidebar');
            if (!sidebar.classList.contains('collapsed')) return;
            const tip = getNavTooltip();
            tip.textContent = item.getAttribute('data-tooltip') || '';
            const rect = item.getBoundingClientRect();
            tip.style.top = Math.round(rect.top + rect.height / 2) + 'px';
            tip.style.left = Math.round(rect.right + 10) + 'px';
            tip.style.display = 'block';
        });
        item.addEventListener('mouseleave', hideNavTooltip);
    });
    // Keep tooltip in sync with sidebar scroll / window resize
    document.querySelector('.sidebar-nav').addEventListener('scroll', hideNavTooltip);
    window.addEventListener('resize', hideNavTooltip);
}

function toggleSidebar(e) {
    e.stopPropagation();
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.toggle('collapsed');
    hideNavTooltip();
    refreshIcons();
}

function expandSidebar(e) {
    e.stopPropagation();
    const sidebar = document.querySelector('.sidebar');
    if (sidebar.classList.contains('collapsed')) {
        sidebar.classList.remove('collapsed');
        hideNavTooltip();
        refreshIcons();
    }
}

function collapseSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar.classList.contains('collapsed')) {
        sidebar.classList.add('collapsed');
        hideNavTooltip();
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
        
        // Restore existing session (v2) - re-applies module visibility, dept selector, etc.
        if (state.currentUser) {
            setAuthenticatedUser(state.currentUser);
        } else {
            // Load initial mock or live data
            triggerDataLoad();
        }
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
    
    // Filter projects based on user permissions (capped by department scope)
    let allowedProjs = state.metadata.projects;
    const effProjects = getEffectiveAllowedProjects();
    if (effProjects !== 'ALL') {
        const userProjList = effProjects.map(s => s.toLowerCase());
        allowedProjs = state.metadata.projects.filter(p => userProjList.includes(p.toLowerCase()));
    }
    
    if (allowedProjs.length === 0) {
        // Never fall back to ALL projects on an empty scope — show an empty state instead
        projSel.innerHTML = `<option value="">No accessible projects</option>`;
        state.selectedProject = '';
        compSel.innerHTML = `<option value="">Select Entity...</option>`;
        state.selectedCompany = '';
        showToast('Your account has no accessible projects for this selection.', 'amber');
        return;
    }
    
    projSel.innerHTML = allowedProjs.map(p => `<option value="${p}">${p}</option>`).join('');
    state.selectedProject = projSel.value;
    
    // Populate company entities based on selected project
    updateCompanyDropdownForProject(state.selectedProject);
}

function updateCompanyDropdownForProject(projectName) {
    const compSel = document.getElementById('company-select');
    const mapping = state.metadata.projectCompanyMapping || {};
    
    let entities = mapping[projectName] || state.metadata.companies;
    
    // Filter by effective allowed companies (user + department scope)
    const effCompanies = getEffectiveAllowedCompanies();
    if (effCompanies !== 'ALL') {
        const userCompList = effCompanies.map(s => s.toLowerCase());
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
        const prev = state.selectedProject;
        if (!confirmDiscardDraft()) { e.target.value = prev; return; }
        state.selectedProject = e.target.value;
        updateCompanyDropdownForProject(state.selectedProject);
        triggerDataLoad();
    });
    
    // Company selector change
    document.getElementById('company-select').addEventListener('change', (e) => {
        const prev = state.selectedCompany;
        if (!confirmDiscardDraft()) { e.target.value = prev; return; }
        state.selectedCompany = e.target.value;
        triggerDataLoad();
    });
    
    // Department selector change (super admin only - switches which dept's entries are shown)
    document.getElementById('dept-select').addEventListener('change', (e) => {
        const prev = state.selectedDepartment;
        if (!confirmDiscardDraft()) { e.target.value = prev; return; }
        state.selectedDepartment = e.target.value;
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
    
    // Tooltips for collapsed sidebar
    initNavTooltips();

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
    
    // Mock data & role preview (super admin only)
    document.getElementById('mock-btn').addEventListener('click', toggleMockMode);
    document.getElementById('viewas-select').addEventListener('change', (e) => applyPreviewRole(e.target.value));
    document.getElementById('exit-preview-btn').addEventListener('click', exitPreview);
    
    // YTD filter dropdown
    const ytdSel = document.getElementById('summary-ytd-select');
    if (ytdSel) ytdSel.addEventListener('change', renderSummaryBudgetTable);
    
    // Dynamic lists additions
    document.getElementById('add-revenue-cat').addEventListener('click', addTargetRevenueRow);
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
    document.getElementById('add-nik-btn').addEventListener('click', () => showNikEditModal(null));
    document.getElementById('close-nik-edit-modal').addEventListener('click', hideNikEditModal);
    document.getElementById('cancel-nik-edit-btn').addEventListener('click', hideNikEditModal);
    document.getElementById('save-nik-edit-btn').addEventListener('click', saveNikPermissions);
    
    // Department Management UI (super admin)
    document.getElementById('add-dept-btn').addEventListener('click', () => showDeptEditModal(null));
    document.getElementById('close-dept-edit-modal').addEventListener('click', hideDeptEditModal);
    document.getElementById('cancel-dept-edit-btn').addEventListener('click', hideDeptEditModal);
    document.getElementById('save-dept-edit-btn').addEventListener('click', saveDepartmentPermissions);
    
    // Consolidated summary export buttons
    document.getElementById('export-dept-summary-btn').addEventListener('click', () => exportConsolidatedSummary('dept-summary'));
    document.getElementById('export-fat-summary-btn').addEventListener('click', () => exportConsolidatedSummary('fat-summary'));
}

// Navigation controller
function switchTab(tabId) {
    // Permission guard: users can only open tabs allowed by their role + department modules
    if (!isTabAllowed(tabId)) {
        tabId = getDefaultTab();
    }
    
    // Remember the active tab so a page refresh returns to the same view
    sessionStorage.setItem('budget_active_tab', tabId);
    
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
        case 'dept-summary':
            renderConsolidatedSummary('dept-summary');
            break;
        case 'fat-summary':
            renderConsolidatedSummary('fat-summary');
            break;
        case 'nik-management':
            renderNikManagementTable();
            break;
        case 'departments':
            renderDepartmentsTable();
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
                    <span class="cat-name">${esc(row.category)}</span>
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
    const isCount = field === 'stock_units' || field === 'stock_sqm' || field === 'units' || field === 'sqm';
    val = isCount ? parseCount(val) : parseMoney(val);
    if (mIdx === null) {
        state.data.target_revenue[rIdx][field] = val;
    } else {
        state.data.target_revenue[rIdx][field][mIdx] = val;
    }
    state.isDirty = true;
    updateSyncIndicator(false);
    renderTargetRevenueTable();
}

// Rapid double-click protection for the prompt/dynamic-row adders
const addRowLocks = {};
function withAddLock(key, fn) {
    if (addRowLocks[key]) return;
    addRowLocks[key] = true;
    try { fn(); } finally { setTimeout(() => { addRowLocks[key] = false; }, 350); }
}

function addTargetRevenueRow() {
    withAddLock('revenue', () => {
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
    });
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
                <td>${esc(label)}</td>
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
    val = parseMoney(val);
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
                <td>${esc(label)}</td>
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
    val = parseMoney(val);
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
            html += `<tr class="row-group-header" style="background-color:rgba(139, 92, 246, 0.15)"><td colspan="15">${esc(item.name)}</td></tr>`;
        } else if (item.type === 'sub_header') {
            html += `<tr class="row-group-header"><td colspan="15">${esc(item.name)}</td></tr>`;
        } else if (item.type === 'category_header') {
            html += `<tr style="font-weight:600; color:#d1d5db"><td colspan="15">${esc(item.name)}</td></tr>`;
        } else if (item.type === 'input') {
            const mValues = state.data.marketing_activity[item.row] || Array(12).fill(0);
            const rowSum = mValues.reduce((a, b) => a + b, 0);
            
            html += `
                <tr>
                    <td style="padding-left:30px;">${esc(item.name)}</td>
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
    val = parseMoney(val);
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
    
    if (!state.collapsedHeaders) {
        state.collapsedHeaders = {};
    }

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
        const isGroupHeader = (item.cat && item.cat.includes('.')) || (item.num && item.num.includes('.')) || item.cat === 'Hard Cost' || item.cat === 'Soft Cost';
        
        if (isGroupHeader) {
            let childIdx = idx + 1;
            let hSqm = 0, hRab = 0, hReal = 0, hEst = 0;
            const hMonthly = Array(12).fill(0);

            if (item.cat === 'Hard Cost' || item.cat === 'Soft Cost') {
                // Aggregate across all sub-headers in Hard Cost or Soft Cost
                while (childIdx < items.length) {
                    const child = items[childIdx];
                    if (child.type === 'section_header' || child.num === '1' || child.num === '2' || (item.cat === 'Hard Cost' && child.cat === 'Soft Cost')) break;
                    if (child.row) {
                        const key = child.row;
                        const dRow = state.data.dev_land[key] || { sqm: 0, cost_sqm: 0, rab_spk: 0, realisasi: 0, best_est: 0, monthly: Array(12).fill(0) };
                        hSqm += parseFloat(dRow.sqm) || 0;
                        hRab += parseFloat(dRow.rab_spk) || 0;
                        hReal += parseFloat(dRow.realisasi) || 0;
                        hEst += parseFloat(dRow.best_est) || 0;
                        (dRow.monthly || Array(12).fill(0)).forEach((v, m) => hMonthly[m] += v);
                    }
                    childIdx++;
                }
            } else {
                // Immediate children under specific sub-header (e.g. 2.8, 2.9)
                while (childIdx < items.length) {
                    const child = items[childIdx];
                    const cText = (child.subcat || child.cat || '').trim();
                    const cIsNote = child.cat === 'Catatan' || cText.startsWith('1. Nilai') || cText.startsWith('2. Apabila') || cText.startsWith('3. Apabila') || cText.startsWith('4. Agar') || cText.startsWith('Catatan') || cText === 'TOTAL LAND & DEVELOPMENT COST';
                    const cIsHeader = cIsNote || (child.cat && child.cat.includes('.')) || (child.num && child.num.includes('.')) || child.type === 'section_header' || child.cat === 'Hard Cost' || child.cat === 'Soft Cost';

                    if (cIsHeader) break; // Reached next sub-header

                    if (child.row) {
                        const key = child.row;
                        const dRow = state.data.dev_land[key] || { sqm: 0, cost_sqm: 0, rab_spk: 0, realisasi: 0, best_est: 0, monthly: Array(12).fill(0) };
                        hSqm += parseFloat(dRow.sqm) || 0;
                        hRab += parseFloat(dRow.rab_spk) || 0;
                        hReal += parseFloat(dRow.realisasi) || 0;
                        hEst += parseFloat(dRow.best_est) || 0;
                        (dRow.monthly || Array(12).fill(0)).forEach((v, m) => hMonthly[m] += v);
                    }
                    childIdx++;
                }
            }

            headerSums[idx] = { sqm: hSqm, rab: hRab, real: hReal, est: hEst, monthly: hMonthly };
        }
    });

    let activeParentCollapsed = false;
    let activeSubCollapsed = false;

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
        } else if (item.type === 'section_header' || item.num === '1' || item.num === '2' || item.cat === 'Land Cost' || item.cat === 'Development Cost') {
            const numDisp = item.num || (item.cat === 'Land Cost' ? '1' : '2');
            const titleDisp = item.cat || item.subcat || '';
            const headerKey = `sec_${numDisp}`;
            const isCollapsed = !!state.collapsedHeaders[headerKey];
            activeParentCollapsed = isCollapsed;
            activeSubCollapsed = false;
            
            // Collect section aggregate across all child input rows
            let secSqm = 0, secRab = 0, secReal = 0, secEst = 0;
            const secMonthly = Array(12).fill(0);

            let activeSec = false;
            items.forEach((it) => {
                const itNum = it.num || '';
                const itCat = it.cat || '';
                
                if (it.type === 'section_header' || itNum === '1' || itNum === '2') {
                    activeSec = (numDisp === '1' && (itNum === '1' || itCat.includes('Land Cost'))) ||
                                (numDisp === '2' && (itNum === '2' || itCat.includes('Development Cost')));
                }

                if (activeSec && it.row) {
                    const dRow = state.data.dev_land[it.row] || { sqm: 0, cost_sqm: 0, rab_spk: 0, realisasi: 0, best_est: 0, monthly: Array(12).fill(0) };
                    secSqm += parseFloat(dRow.sqm) || 0;
                    secRab += parseFloat(dRow.rab_spk) || 0;
                    secReal += parseFloat(dRow.realisasi) || 0;
                    secEst += parseFloat(dRow.best_est) || 0;
                    (dRow.monthly || Array(12).fill(0)).forEach((v,m) => secMonthly[m] += v);
                }
            });

            const totalEstSpent = secReal + secEst;
            const pctReal = secRab > 0 ? (totalEstSpent / secRab) : 0;
            const bSum = secMonthly.reduce((a,b)=>a+b,0);
            const costPerSqm = secSqm > 0 ? (secRab / secSqm) : 0;
            const safeKey = headerKey.replace(/[^a-zA-Z0-9_]/g, '_');

            html += `
                <tr class="row-grand-total" style="background:rgba(139,92,246,0.25) !important; font-size:0.9rem;">
                    <td style="font-weight:800; text-align:center;">
                        <button class="btn-icon-xs" onclick="toggleDevLandHeader('${safeKey}')" style="margin-right:4px;">
                            <i data-lucide="${isCollapsed ? 'plus-square' : 'minus-square'}" class="icon-xs"></i>
                        </button>
                        ${numDisp}
                    </td>
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
            const isGroupTitle = (item.cat === 'Hard Cost' || item.cat === 'Soft Cost');
            const numDisp = item.num || item.cat;
            const titleDisp = item.subcat || item.cat;
            const rawKey = isGroupTitle ? `group_${item.cat}` : `hdr_${itemIdx}_${numDisp}`;
            const safeKey = rawKey.replace(/[^a-zA-Z0-9_]/g, '_');
            
            const isCollapsed = !!state.collapsedHeaders[safeKey];

            if (isGroupTitle) {
                activeSubCollapsed = isCollapsed;
            }

            if (activeParentCollapsed) return; // Skip if Section 1 or 2 is collapsed
            if (!isGroupTitle && activeSubCollapsed) return; // Skip sub-headers if Hard/Soft Cost group is collapsed

            const hs = headerSums[itemIdx] || { sqm: 0, rab: 0, real: 0, est: 0, monthly: Array(12).fill(0) };
            const totalEstSpent = hs.real + hs.est;
            const pctReal = hs.rab > 0 ? (totalEstSpent / hs.rab) : 0;
            const bSum = hs.monthly.reduce((a,b)=>a+b,0);
            const costPerSqm = hs.sqm > 0 ? (hs.rab / hs.sqm) : 0;

            const headerSelfKey = `hdr_${itemIdx}_${numDisp}`.replace(/[^a-zA-Z0-9_]/g, '_');
            const isSelfCollapsed = !!state.collapsedHeaders[headerSelfKey];

            html += `
                <tr class="row-group-header">
                    <td style="font-weight:700; text-align:center;">
                        <button class="btn-icon-xs" onclick="toggleDevLandHeader('${safeKey}')" style="margin-right:4px;">
                            <i data-lucide="${isCollapsed ? 'plus-square' : 'minus-square'}" class="icon-xs"></i>
                        </button>
                        ${numDisp}
                    </td>
                    <td style="font-weight:700">
                        ${titleDisp}
                        ${!isGroupTitle ? `<button class="btn btn-secondary btn-sm" onclick="addDevLandSubRow(${itemIdx})" title="Add sub-row under this header" style="font-size:0.7rem; padding:2px 8px; margin-left:10px;"><i data-lucide="plus"></i> Sub-Row</button>` : ''}
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
            const numDisp = item.num || '';
            let currentSubCollapsed = false;

            // Find parent sub-header collapse status for this row
            for (let i = itemIdx - 1; i >= 0; i--) {
                const prev = items[i];
                if ((prev.cat && prev.cat.includes('.')) || (prev.num && prev.num.includes('.'))) {
                    const pNum = prev.num || prev.cat;
                    const pKey = `hdr_${i}_${pNum}`.replace(/[^a-zA-Z0-9_]/g, '_');
                    currentSubCollapsed = !!state.collapsedHeaders[pKey];
                    break;
                }
            }

            if (activeParentCollapsed || activeSubCollapsed || currentSubCollapsed) return; // Skip hidden rows

            const key = item.row;
            const dataRow = state.data.dev_land[key] || { name: (item.subcat || item.cat || ''), sqm: 0, cost_sqm: 0, rab_spk: 0, realisasi: 0, best_est: 0, monthly: Array(12).fill(0) };
            
            const totalEstSpent = dataRow.realisasi + dataRow.best_est;
            const pctReal = dataRow.rab_spk > 0 ? (totalEstSpent / dataRow.rab_spk) : 0;
            const budgetSum = dataRow.monthly.reduce((a, b) => a + b, 0);
            
            const descValue = dataRow.name !== undefined ? dataRow.name : (item.subcat || item.cat || '');
            
            html += `
                <tr>
                    <td style="font-weight:600; color:var(--text-secondary); text-align:center;">${numDisp}</td>
                    <td>
                        <input type="text" class="table-input" style="width:100%; text-align:left; font-weight:500;" value="${esc(descValue)}" placeholder="Description / Item Name" onchange="updateDevLandName('${key}', ${itemIdx}, this.value)">
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
    val = (field === 'sqm') ? parseCount(val) : parseMoney(val);
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

function toggleDevLandHeader(headerKey) {
    if (!state.collapsedHeaders) state.collapsedHeaders = {};
    state.collapsedHeaders[headerKey] = !state.collapsedHeaders[headerKey];
    // Re-render the table that owns this header (dev-land, marketing, corp-event or G&A)
    if (headerKey.indexOf('ga_') === 0) renderGAOthersTables();
    else if (headerKey.indexOf('mkt_') === 0) renderMarketingActivityTables();
    else if (headerKey.indexOf('ce_') === 0) renderCorpEventTable();
    else renderDevLandTable();
}

// 5. MODULE RENDER: BUDGET PAYROLL (COA-based)
function renderPayrollTable() {
    renderExpensesSubTable('employee-table', state.templates.payroll, state.data.payroll_expenses, 'payroll');
}

function updatePayroll(code, mIdx, val) {
    val = parseMoney(val);
    if (!state.data.payroll_expenses[code]) {
        state.data.payroll_expenses[code] = Array(12).fill(0);
    }
    state.data.payroll_expenses[code][mIdx] = val;
    state.isDirty = true;
    updateSyncIndicator(false);
    renderPayrollTable();
}

// 6. MODULE RENDER: G&A (hierarchical COA headers + user child rows), OTHERS, FINANCE, TAX
// ------------------------------------------------------------------------------------
// G&A model: each COA account is a HEADER row. Users add child rows under it (name + 12
// months). The parent COA monthly totals = sum of its children, and ga_expenses[code]
// (the parent array) stays the source of truth for summaries, consolidation and export.
// Legacy flat values auto-materialize as an "Existing Budget" child so no data is lost.

function ensureGaChildren() {
    if (!state.data.ga_children) state.data.ga_children = {};
    Object.keys(state.data.ga_expenses || {}).forEach(code => {
        const existing = state.data.ga_children[code] || [];
        // Normalize any malformed child rows (short/non-numeric monthly arrays) so the
        // renderer always sees 12 numeric months
        existing.forEach(c => {
            if (!Array.isArray(c.monthly)) c.monthly = Array(12).fill(0);
            for (let m = 0; m < 12; m++) c.monthly[m] = (parseFloat(c.monthly[m]) || 0);
        });
        if (existing.length > 0) return;
        const parent = state.data.ga_expenses[code];
        if (Array.isArray(parent) && parent.some(v => v && v !== 0)) {
            state.data.ga_children[code] = [{ id: 'ga_child_' + code + '_0', name: 'Existing Budget', monthly: parent.map(v => (parseFloat(v) || 0)) }];
        }
    });
}

function recomputeGaParent(code) {
    const children = state.data.ga_children && state.data.ga_children[code];
    if (!children || children.length === 0) return;
    const sums = Array(12).fill(0);
    children.forEach(c => {
        (c.monthly || Array(12).fill(0)).forEach((v, m) => { sums[m] += (parseFloat(v) || 0); });
    });
    state.data.ga_expenses[code] = sums;
}

function addGaChild(code) {
    withAddLock('ga_child_' + code, () => {
        ensureGaChildren();
        const children = state.data.ga_children[code] || [];
        children.push({
            id: 'ga_child_' + code + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            name: 'Detail ' + (children.length + 1),
            monthly: Array(12).fill(0)
        });
        state.data.ga_children[code] = children;
        recomputeGaParent(code);
        state.isDirty = true;
        updateSyncIndicator(false);
        renderGAOthersTables();
    });
}

function updateGaChild(code, childIdx, mIdx, val) {
    const child = (state.data.ga_children[code] || [])[childIdx];
    if (!child) return;
    if (!child.monthly) child.monthly = Array(12).fill(0);
    child.monthly[mIdx] = parseMoney(val);
    recomputeGaParent(code);
    state.isDirty = true;
    updateSyncIndicator(false);
    renderGAOthersTables();
}

function updateGaChildName(code, childIdx, val) {
    const child = (state.data.ga_children[code] || [])[childIdx];
    if (!child) return;
    child.name = val;
    state.isDirty = true;
    updateSyncIndicator(false);
    // No re-render here: keeps focus in the input while typing
}

function removeGaChild(code, childIdx) {
    if (!confirm('Delete this row?')) return;
    const children = state.data.ga_children[code] || [];
    children.splice(childIdx, 1);
    state.data.ga_children[code] = children;
    recomputeGaParent(code);
    state.isDirty = true;
    updateSyncIndicator(false);
    renderGAOthersTables();
}

function renderGaHierarchyTable() {
    ensureGaChildren();
    recomputeGaParents();
    const table = document.getElementById('ga-table');
    if (!state.collapsedHeaders) state.collapsedHeaders = {};

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

    state.templates.ga.forEach(acc => {
        const code = acc.code;
        const children = state.data.ga_children[code] || [];
        const parent = state.data.ga_expenses[code] || Array(12).fill(0);
        const parentSum = parent.reduce((a, b) => a + b, 0);
        parent.forEach((v, m) => { monthlyTotals[m] += v; });

        const safeKey = ('ga_' + code).replace(/[^a-zA-Z0-9_]/g, '_');
        const isCollapsed = !!state.collapsedHeaders[safeKey];

        html += `
            <tr class="row-group-header" style="background:rgba(139,92,246,0.15);">
                <td style="font-weight:700; font-family:monospace;">
                    <button class="btn-icon-xs" onclick="toggleDevLandHeader('${safeKey}')" style="margin-right:4px;" title="${isCollapsed ? 'Expand' : 'Collapse'}">
                        <i data-lucide="${isCollapsed ? 'plus-square' : 'minus-square'}" class="icon-xs"></i>
                    </button>
                    ${esc(code)}
                </td>
                <td style="font-weight:700;">
                    ${esc(acc.name)}
                    <button class="btn btn-secondary btn-sm" onclick="addGaChild('${esc(code)}')" title="Add child row under this COA" style="font-size:0.7rem; padding:2px 8px; margin-left:10px;"><i data-lucide="plus"></i> Row</button>
                </td>
                <td style="font-weight:700;">${parentSum.toLocaleString('id-ID')}</td>
                ${parent.map(v => `<td style="font-weight:700;">${v ? v.toLocaleString('id-ID') : '-'}</td>`).join('')}
            </tr>`;

        if (!isCollapsed) {
            children.forEach((child, childIdx) => {
                const cMonthly = child.monthly || Array(12).fill(0);
                const cSum = cMonthly.reduce((a, b) => a + b, 0);
                html += `
                    <tr>
                        <td></td>
                        <td style="padding-left:24px;">
                            <input type="text" class="table-input" style="width:88%; text-align:left;" value="${esc(child.name)}" placeholder="Detail description" onchange="updateGaChildName('${esc(code)}', ${childIdx}, this.value)">
                            <button class="btn-delete" onclick="removeGaChild('${esc(code)}', ${childIdx})" title="Delete row"><i data-lucide="trash-2"></i></button>
                        </td>
                        <td><span style="font-weight:600;">${cSum.toLocaleString('id-ID')}</span></td>
                        ${cMonthly.map((val, mIdx) => `<td><input type="number" class="table-input" value="${val}" onchange="updateGaChild('${esc(code)}', ${childIdx}, ${mIdx}, this.value)"></td>`).join('')}
                    </tr>`;
            });
        }
    });

    const grandSum = monthlyTotals.reduce((a, b) => a + b, 0);
    const expYTD = [];
    for (let m = 0; m < 12; m++) expYTD[m] = (expYTD[m-1] || 0) + monthlyTotals[m];

    html += `
        <tr class="row-grand-total">
            <td colspan="2">TOTAL GA EXPENSES</td>
            <td>${grandSum.toLocaleString('id-ID')}</td>
            ${monthlyTotals.map(val => `<td>${val.toLocaleString('id-ID')}</td>`).join('')}
        </tr>
        <tr class="row-ytd">
            <td colspan="2">GA YTD</td>
            <td>${grandSum.toLocaleString('id-ID')}</td>
            ${expYTD.map(val => `<td>${val.toLocaleString('id-ID')}</td>`).join('')}
        </tr>
        </tbody>
    `;

    table.innerHTML = html;
    refreshIcons();
}

function recomputeGaParents() {
    Object.keys(state.data.ga_children || {}).forEach(recomputeGaParent);
}

function renderGAOthersTables() {
    renderGaHierarchyTable();
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
    val = parseMoney(val);
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

function renderMarketingSubTable(tableId, typeText) {
    const table = document.getElementById(tableId);
    
    if (!state.collapsedHeaders) state.collapsedHeaders = {};

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
    
    let activeHeaderCollapsed = false;

    filterRows.forEach((item, itemIdx) => {
        if (item.type === 'main_header' || item.type === 'sub_header' || item.type === 'category_header') {
            const safeKey = `mkt_${tableId}_${item.row}_${itemIdx}`.replace(/[^a-zA-Z0-9_]/g, '_');
            const isCollapsed = !!state.collapsedHeaders[safeKey];

            if (item.type === 'main_header' || item.type === 'sub_header') {
                activeHeaderCollapsed = isCollapsed;
            }

            const styleBg = item.type === 'main_header' ? 'background-color:rgba(139, 92, 246, 0.15); font-weight:700;' :
                            item.type === 'sub_header' ? 'font-weight:700;' : 'font-weight:600; color:#d1d5db;';

            html += `
                <tr class="row-group-header" style="${styleBg}">
                    <td colspan="15">
                        <button class="btn-icon-xs" onclick="toggleDevLandHeader('${safeKey}')" style="margin-right:6px;">
                            <i data-lucide="${isCollapsed ? 'plus-square' : 'minus-square'}" class="icon-xs"></i>
                        </button>
                        ${esc(item.name)}
                    </td>
                </tr>`;
        } else if (item.type === 'input') {
            if (activeHeaderCollapsed) return; // Skip input row if parent header is collapsed

            const mValues = state.data.marketing_activity[item.row] || Array(12).fill(0);
            const rowSum = mValues.reduce((a, b) => a + b, 0);
            
            html += `
                <tr>
                    <td style="padding-left:30px;">${esc(item.name)}</td>
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
    refreshIcons();
}

function updateMarketingActivity(rowId, mIdx, val) {
    val = parseMoney(val);
    if (!state.data.marketing_activity[rowId]) {
        state.data.marketing_activity[rowId] = Array(12).fill(0);
    }
    state.data.marketing_activity[rowId][mIdx] = val;
    state.isDirty = true;
    updateSyncIndicator(false);
    renderMarketingActivityTables();
}

// 7. MODULE RENDER: CORPORATE EVENTS
function renderCorpEventTable() {
    const table = document.getElementById('corp-event-table');
    
    if (!state.collapsedHeaders) state.collapsedHeaders = {};
    
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
    let activeCorpCollapsed = false;
    
    state.templates.corp_event.forEach((item, itemIdx) => {
        if (item.type === 'header') {
            const safeKey = `ce_${itemIdx}_${item.activity}`.replace(/[^a-zA-Z0-9_]/g, '_');
            const isCollapsed = !!state.collapsedHeaders[safeKey];
            activeCorpCollapsed = isCollapsed;

            html += `
                <tr class="row-group-header">
                    <td colspan="17" style="font-weight:700; font-size:0.95rem;">
                        <button class="btn-icon-xs" onclick="toggleDevLandHeader('${safeKey}')" style="margin-right:6px;">
                            <i data-lucide="${isCollapsed ? 'plus-square' : 'minus-square'}" class="icon-xs"></i>
                        </button>
                        ${esc(item.activity)}
                    </td>
                    <td style="background:none;">
                        <button class="btn btn-secondary btn-sm" onclick="addCorpEventDetail(${itemIdx})" title="Add detail row under this category" style="font-size:0.7rem; padding:3px 8px;"><i data-lucide="plus"></i> Detail</button>
                        <button class="btn-icon btn-danger" onclick="removeCorpEventCategory(${itemIdx})" title="Remove category">&times;</button>
                    </td>
                </tr>`;
        } else {
            if (activeCorpCollapsed) return; // Skip detail row if category header is collapsed

            const key = item.row;
            const dataRow = state.data.corp_events[key] || { qty: 0, price_unit: 0, monthly: Array(12).fill(0) };
            
            const subtotal = dataRow.qty * dataRow.price_unit;
            const monthlySum = dataRow.monthly.reduce((a, b) => a + b, 0);
            
            html += `
                <tr>
                    <td style="padding-left:30px;">${esc(item.activity)}</td>
                    <td><span style="font-size:0.75rem; color:var(--text-secondary)">${esc(item.classification || '')}</span></td>
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
    withAddLock('ce', () => {
        const catName = prompt('Enter category title (e.g. "Town Hall Meeting"):');
        if (!catName || catName.trim() === '') return;
        state.templates.corp_event.push({ type: 'header', activity: catName.trim(), row: null });
        state.isDirty = true;
        updateSyncIndicator(false);
        renderCorpEventTable();
    });
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
    val = (field === 'qty') ? parseCount(val) : parseMoney(val);
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
                <td><input type="text" value="${esc(row.division)}" placeholder="e.g. Sales" onchange="updateFixedAsset(${idx}, 'division', this.value)"></td>
                <td>
                    <select onchange="updateFixedAsset(${idx}, 'category', this.value)">
                        ${categories.map(c => `<option value="${c}" ${row.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                </td>
                <td><input type="text" value="${esc(row.desc)}" placeholder="e.g. Laptop Core i7" onchange="updateFixedAsset(${idx}, 'desc', this.value)"></td>
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
    withAddLock('fa', () => {
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
    });
}

function updateFixedAsset(idx, field, val) {
    if (field === 'qty') val = parseCount(val);
    else if (field === 'price') val = parseMoney(val);
    else if (field === 'month') val = parseFloat(val) || 0;
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
                <td><input type="text" value="${esc(row.employee)}" placeholder="e.g. Rudi" onchange="updateTrip(${idx}, 'employee', this.value)"></td>
                <td><input type="text" value="${esc(row.division)}" placeholder="e.g. Sales" onchange="updateTrip(${idx}, 'division', this.value)"></td>
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
                <td><input type="text" value="${esc(row.city)}" placeholder="e.g. Jakarta" onchange="updateTrip(${idx}, 'city', this.value)"></td>
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
    withAddLock('trip', () => {
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
    });
}

function updateTrip(idx, field, val) {
    if (field === 'duration') val = parseCount(val);
    else if (field === 'month') val = parseFloat(val) || 0;
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

    // ── Get YTD month filter selection (1 = Jan, ..., 12 = Full Year) ────
    const ytdSel = document.getElementById('summary-ytd-select');
    const maxMonth = ytdSel ? (parseInt(ytdSel.value, 10) || 12) : 12;

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
        const hmap = {'Director':{'Local':1650000,'Overseas':2500000},'Manager':{'Local':750000,'Overseas':1200000},'SPV':{'Local':600000,'Overseas':1000000},'Staff':{'Local':600000,'Overseas':800000}};
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

    // ── Sum up to selected YTD maxMonth (default 12 for Full Year) ────────
    const sum = arr => arr.slice(0, maxMonth).reduce((a,b)=>a+b,0);
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
    state.data.summary_2026[key] = parseMoney(val);
    state.isDirty = true;
    updateSyncIndicator(false);
    renderSummaryBudgetTable();
}

// ----------------------------------------------------
// CONSOLIDATED SUMMARY (dept head: all projects / FAT: all departments)
// ----------------------------------------------------
// Compute 12-month totals per module from any budget data object.
// Mirrors the Consolidated Budget tab math; defensive against missing keys.
function computeMonthlyTotals(d) {
    const mRevenue = Array(12).fill(0), mUnits = Array(12).fill(0), mSqm = Array(12).fill(0);
    (d.target_revenue || []).forEach(row => {
        (row.sqm || []).forEach((s, m) => { mRevenue[m] += (s || 0) * (row.price_sqm || 0); mSqm[m] += (s || 0); });
        (row.units || []).forEach((u, m) => { mUnits[m] += (u || 0); });
    });
    const mSalesInhouse = Array(12).fill(0), mSalesAgent = Array(12).fill(0);
    const mSalesProgram = Array(12).fill(0);
    const mMarketingATL = Array(12).fill(0), mMarketingBTL = Array(12).fill(0);
    const mDevLand = Array(12).fill(0), mEmployee = Array(12).fill(0);
    const mGA = Array(12).fill(0), mOthers = Array(12).fill(0);
    const mFinance = Array(12).fill(0), mTax = Array(12).fill(0);
    const mCorpEvent = Array(12).fill(0), mCapex = Array(12).fill(0);
    const sc = (d.sales_cost || {}), pg = (d.program_sales || {});
    const amap = {'Director':{'Local':1500000,'Overseas':2000000},'Manager':{'Local':900000,'Overseas':1200000},'SPV':{'Local':750000,'Overseas':1000000},'Staff':{'Local':600000,'Overseas':800000}};
    const hmap = {'Director':{'Local':1650000,'Overseas':2500000},'Manager':{'Local':750000,'Overseas':1200000},'SPV':{'Local':600000,'Overseas':1000000},'Staff':{'Local':500000,'Overseas':800000}};
    for (let m = 0; m < 12; m++) {
        Object.keys(sc.inhouse || {}).filter(k => !k.startsWith('_')).forEach(k => { mSalesInhouse[m] += (sc.inhouse[k] || [])[m] || 0; });
        Object.keys(sc.agent || {}).filter(k => !k.startsWith('_')).forEach(k => { mSalesAgent[m] += (sc.agent[k] || [])[m] || 0; });
        Object.keys(pg).filter(k => !k.startsWith('_')).forEach(k => { mSalesProgram[m] += (pg[k] || [])[m] || 0; });
        (state.templates.marketing || []).forEach(item => {
            if (item.type === 'input') {
                const v = (d.marketing_activity || {})[item.row] ? ((d.marketing_activity[item.row] || [])[m] || 0) : 0;
                if (item.row < 46) mMarketingATL[m] += v; else mMarketingBTL[m] += v;
            }
        });
        Object.keys(d.dev_land || {}).forEach(r => { mDevLand[m] += ((d.dev_land[r] || {}).monthly || [])[m] || 0; });
        Object.keys(d.payroll_expenses || {}).forEach(c => { mEmployee[m] += (d.payroll_expenses[c] || [])[m] || 0; });
        Object.keys(d.ga_expenses || {}).forEach(c => { mGA[m] += (d.ga_expenses[c] || [])[m] || 0; });
        (d.business_trip || []).forEach(r => {
            if (r.month == m) {
                const g = r.grade || 'Staff', dd = r.destination || 'Local';
                const flt = r.ticket_price != null ? r.ticket_price : (dd === 'Overseas' ? 8000000 : 4000000);
                mGA[m] += flt + ((hmap[g] || hmap.Staff)[dd]) * Math.max(0, (r.duration || 0) - 1) + ((amap[g] || amap.Staff)[dd]) * (r.duration || 0);
            }
        });
        Object.keys(d.others_expenses || {}).forEach(c => { mOthers[m] += (d.others_expenses[c] || [])[m] || 0; });
        Object.keys(d.finance_expenses || {}).forEach(c => { mFinance[m] += (d.finance_expenses[c] || [])[m] || 0; });
        Object.keys(d.tax_expenses || {}).forEach(c => { mTax[m] += (d.tax_expenses[c] || [])[m] || 0; });
        Object.keys(d.corp_events || {}).forEach(r => { mCorpEvent[m] += ((d.corp_events[r] || {}).monthly || [])[m] || 0; });
        (d.fixed_assets || []).forEach(r => { if (r.month == m) mCapex[m] += (r.qty || 0) * (r.price || 0); });
    }
    return { mRevenue, mUnits, mSqm, mSalesInhouse, mSalesAgent, mSalesProgram, mMarketingATL, mMarketingBTL, mDevLand, mEmployee, mGA, mOthers, mFinance, mTax, mCorpEvent, mCapex };
}

// Render the aggregated summary table.
// dept-summary: one department across ALL projects. fat-summary: ALL departments of the selected project.
async function renderConsolidatedSummary(tabId) {
    const isDeptView = tabId === 'dept-summary';
    const table = document.getElementById(isDeptView ? 'dept-summary-table' : 'fat-summary-table');
    const scopeEl = document.getElementById(isDeptView ? 'dept-summary-scope' : 'fat-summary-scope');
    if (!table) return;
    if (!state.showProjectEntities) {
        try { state.showProjectEntities = JSON.parse(localStorage.getItem('budget_show_entities')) || {}; }
        catch (e) { state.showProjectEntities = {}; }
    }
    state.consolidatedExport = null;

    let scope, params = '', scopeLabel;
    if (isDeptView) {
        scope = 'dept';
        const dept = isSuperAdmin() ? state.selectedDepartment : (state.currentUser.department || '');
        if (!dept) {
            scopeEl.textContent = 'No division assigned. Ask a super admin to assign your division.';
            table.innerHTML = '';
            return;
        }
        scopeLabel = dept + ' — all projects';
        params = `&department=${encodeURIComponent(dept)}`;
    } else {
        scope = 'project';
        if (!state.selectedProject) {
            scopeEl.textContent = 'Select a project first.';
            table.innerHTML = '';
            return;
        }
        scopeLabel = state.selectedProject + ' — all divisions';
        params = `&project=${encodeURIComponent(state.selectedProject)}`;
    }
    scopeEl.textContent = 'Aggregating ' + scopeLabel + '...';
    table.innerHTML = `<tr><td colspan="14" style="text-align:center; padding:24px; color:var(--text-secondary);">Loading summary...</td></tr>`;

    let merged = null, rowCount = 0, entries = [], mockTotals = null;
    if (state.mockMode) {
        // Mock mode is browser-only: aggregate the seeded local drafts (draft_* keys)
        // so the view shows ALL projects (dept view) / ALL divisions (FAT view)
        const targetDept = isDeptView ? (isSuperAdmin() ? state.selectedDepartment : (state.currentUser.department || '')) : '';
        const rows = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || k.indexOf('draft_') !== 0) continue;
            try {
                const meta = parseDraftKey(k);
                if (isDeptView ? (meta.dept === targetDept) : (meta.project === state.selectedProject)) {
                    rows.push({ company: meta.company, project: meta.project, dept: meta.dept, data: JSON.parse(localStorage.getItem(k)) });
                }
            } catch (e) { /* skip unreadable draft */ }
        }
        if (rows.length > 0) {
            entries = rows.map(r => ({ company: r.company, project: r.project, department: r.dept, data: r.data }));
            rowCount = rows.length;
            // Merged totals = element-wise sum of per-row totals
            const T0 = computeMonthlyTotals(rows[0].data);
            mockTotals = {};
            Object.keys(T0).forEach(k => { mockTotals[k] = T0[k].slice(); });
            for (let i = 1; i < rows.length; i++) {
                const Ti = computeMonthlyTotals(rows[i].data);
                Object.keys(mockTotals).forEach(k => { mockTotals[k].forEach((v, m) => { mockTotals[k][m] += Ti[k][m]; }); });
            }
            merged = {};
            scopeLabel += ' · mock data (browser only)';
        }
    } else if (state.gasUrl) {
        try {
            // GAS cold starts are slow: give the summary (heaviest call) a long window
            const res = await fetchGasGet(`${state.gasUrl}?action=summary&scope=${scope}${params}`, 45000);
            const json = await res.json();
            if (json.status === 'success' && json.data) {
                merged = json.data;
                rowCount = (json.meta && json.meta.rows) || 0;
                entries = (json.meta && json.meta.entries) || [];
            } else {
                scopeEl.textContent = 'Backend returned an error for ' + scopeLabel + '. Check the GAS backend connection.';
                table.innerHTML = `<tr><td colspan="20" style="text-align:center; padding:24px; color:var(--text-secondary);">Backend error: ${esc(json.message || 'unknown')}</td></tr>`;
                return;
            }
        } catch (err) {
            if (!isAbortError(err)) console.error(err);
            scopeEl.textContent = 'Failed to load summary for ' + scopeLabel + '. Check the backend connection and try again.';
            table.innerHTML = `<tr><td colspan="20" style="text-align:center; padding:24px; color:var(--text-secondary);">Failed to load summary. If the backend is cold-starting, click the tab again in a few seconds.</td></tr>`;
            return;
        }
    }
    if ((!merged || Object.keys(merged).length === 0) && !mockTotals) {
        scopeEl.textContent = 'No saved budget entries found for ' + scopeLabel + '.';
        table.innerHTML = `<tr><td colspan="20" style="text-align:center; padding:24px; color:var(--text-secondary);">No saved budget data to summarize. Save budgets first (or check the backend connection).</td></tr>`;
        return;
    }
    scopeEl.textContent = 'Scope: ' + scopeLabel + ' · ' + rowCount + ' saved entr' + (rowCount === 1 ? 'y' : 'ies') + ' aggregated';

    const sum = arr => arr.reduce((a, b) => a + b, 0);
    // One annual number per category line (no months in this view)
    const annual = T => ({
        revenue: sum(T.mRevenue), units: sum(T.mUnits), sqm: sum(T.mSqm),
        devLand: sum(T.mDevLand),
        salesInhouse: sum(T.mSalesInhouse), salesAgent: sum(T.mSalesAgent), salesProgram: sum(T.mSalesProgram),
        mktATL: sum(T.mMarketingATL), mktBTL: sum(T.mMarketingBTL),
        payroll: sum(T.mEmployee), ga: sum(T.mGA), others: sum(T.mOthers),
        finance: sum(T.mFinance), tax: sum(T.mTax), corpEvent: sum(T.mCorpEvent),
        capex: sum(T.mCapex)
    });
    const withSubtotals = A => {
        const salesMktg = A.salesInhouse + A.salesAgent + A.salesProgram + A.mktATL + A.mktBTL;
        const empOps = A.payroll + A.ga + A.others + A.finance + A.tax + A.corpEvent;
        return { salesMktg, empOps, totalCost: A.devLand + salesMktg + empOps + A.capex };
    };
    const ratioOf = A => (A.revenue > 0 ? (withSubtotals(A).totalCost / A.revenue * 100) : 0);

    const mergedA = annual(mockTotals || computeMonthlyTotals(merged));

    // Column model: TOTAL 2027 first, then one block per group.
    // All Projects view: group = project, with entity sub-columns when a project has
    // multiple entities (Collins, Sequoia) plus a project TOTAL; entity columns toggleable.
    // FAT view: group = division (flat).
    const colGetters = [];       // per-column totals objects (excluding TOTAL 2027)
    const header1 = [{ text: 'TOTAL 2027', rowspan: 2, total: true }]; // row 1: project/division names
    const header2 = [];          // row 2: entity names / TOTAL (All Projects view only)
    const exportH1 = ['TOTAL 2027'];
    const exportH2 = [''];
    if (isDeptView) {
        const projects = [];
        const projectMap = {};
        entries.forEach(e => {
            const pName = e.project || '(no project)';
            if (!projectMap[pName]) { projectMap[pName] = { name: pName, entities: [], entityMap: {}, total: null }; projects.push(projectMap[pName]); }
            const P = projectMap[pName];
            const cName = e.company || '';
            if (!P.entityMap[cName]) { P.entityMap[cName] = { company: cName, totals: null, count: 0 }; P.entities.push(P.entityMap[cName]); }
            const A = annual(computeMonthlyTotals(e.data || {}));
            const ent = P.entityMap[cName];
            if (!ent.totals) ent.totals = A;
            else Object.keys(A).forEach(k => { ent.totals[k] += A[k]; });
            ent.count++;
            if (!P.total) P.total = Object.keys(A).reduce((acc, k) => { acc[k] = A[k]; return acc; }, {});
            else Object.keys(A).forEach(k => { P.total[k] += A[k]; });
        });
        // Deterministic column order: projects and entities alphabetical
        // (project names coincide with metadata order)
        projects.sort((a, b) => a.name.localeCompare(b.name));
        projects.forEach(P => {
            P.entities.sort((a, b) => a.company.localeCompare(b.company));
            const multi = P.entities.length > 1;
            const show = multi && state.showProjectEntities[P.name] !== false;
            const btn = multi ? `<button class="btn-icon-xs" onclick="toggleProjectEntities('${esc(P.name)}')" title="${show ? 'Hide entity columns' : 'Show entity columns'}"><i data-lucide="${show ? 'eye' : 'eye-off'}" class="icon-xs"></i></button> ` : '';
            if (multi && show) {
                header1.push({ text: btn + esc(P.name), colspan: P.entities.length + 1 });
                P.entities.forEach(e => {
                    header2.push({ text: esc(e.company || '(none)') });
                    colGetters.push(e.totals);
                    exportH1.push(P.name); exportH2.push(e.company || '(none)');
                });
                header2.push({ text: 'TOTAL' });
                colGetters.push(P.total);
                exportH1.push(P.name); exportH2.push('TOTAL');
            } else {
                header1.push({ text: btn + esc(P.name), rowspan: 2 });
                colGetters.push(P.total);
                exportH1.push(P.name); exportH2.push(multi ? 'TOTAL' : (P.entities[0] ? P.entities[0].company : '(none)'));
            }
        });
    } else {
        const groups = [];
        const groupMap = {};
        entries.forEach(e => {
            const key = e.department || '(none)';
            if (!groupMap[key]) { groupMap[key] = { label: key, totals: null, count: 0 }; groups.push(groupMap[key]); }
            const A = annual(computeMonthlyTotals(e.data || {}));
            const g = groupMap[key];
            if (!g.totals) g.totals = A;
            else Object.keys(A).forEach(k => { g.totals[k] += A[k]; });
            g.count++;
        });
        groups.forEach(g => {
            header1.push({ text: esc(g.label) + (g.count > 1 ? ' <span style="opacity:.55;font-weight:500">(' + g.count + ')</span>' : '') });
            colGetters.push(g.totals);
            exportH1.push(g.label); exportH2.push('');
        });
    }

    const money = v => formatShortCurrency(v);
    const num = v => Math.round(v).toLocaleString('id-ID');

    let html = `<thead><tr><th style="min-width:200px">Category</th>`;
    header1.forEach(c => {
        const style = 'min-width:130px' + (c.total ? '; background:var(--accent-purple); color:#fff;' : '');
        html += `<th style="${style}"${c.rowspan ? ' rowspan="' + c.rowspan + '"' : ''}${c.colspan ? ' colspan="' + c.colspan + '"' : ''}>${c.text}</th>`;
    });
    html += '</tr>';
    if (header2.length) {
        html += '<tr>';
        header2.forEach(c => { html += `<th style="min-width:130px; font-weight:600;">${c.text}</th>`; });
        html += '</tr>';
    }
    html += '</thead><tbody>';

    const colCount = 2 + colGetters.length;
    const secHdr = label => `<tr class="row-group-header"><td colspan="${colCount}" style="font-size:0.85rem;letter-spacing:0.05em;">${label}</td></tr>`;
    const row = (label, getVal, fmt, cls, style) => {
        html += `<tr${cls ? ' class="' + cls + '"' : ''}><td${style ? ' style="' + style + '"' : ''}>${label}</td><td class="cell-computed" style="font-weight:700">${fmt(getVal(mergedA))}</td>${colGetters.map(g => `<td class="cell-computed">${fmt(getVal(g))}</td>`).join('')}</tr>`;
    };

    // Revenue block
    row('Target Revenue', A => A.revenue, money, 'row-grand-total', 'style="font-weight:800"');
    row('Units Sold', A => A.units, num, '', 'style="padding-left:28px"');
    row('Sqm Sold', A => A.sqm, num, '', 'style="padding-left:28px"');

    // Cost blocks
    html += secHdr('Project Cost');
    row('Dev & Land Cost', A => A.devLand, money);
    html += secHdr('Sales & Marketing');
    [['Sales Inhouse', A => A.salesInhouse], ['Sales Agent', A => A.salesAgent], ['Program Sales', A => A.salesProgram], ['Marketing ATL', A => A.mktATL], ['Marketing BTL', A => A.mktBTL]].forEach(r => row(r[0], r[1], money, '', 'style="padding-left:28px"'));
    row('Sales & Marketing Total', A => withSubtotals(A).salesMktg, money, 'row-group-total', 'style="font-weight:700"');
    html += secHdr('Employee & Operations');
    [['Payroll', A => A.payroll], ['G&A (incl. Business Trip)', A => A.ga], ['Others', A => A.others], ['Finance', A => A.finance], ['Tax', A => A.tax], ['Corporate Event', A => A.corpEvent]].forEach(r => row(r[0], r[1], money, '', 'style="padding-left:28px"'));
    row('Employee & Operations Total', A => withSubtotals(A).empOps, money, 'row-group-total', 'style="font-weight:700"');
    html += secHdr('Capital');
    row('Capex (Fixed Assets)', A => A.capex, money);

    // Grand total + ratio
    row('TOTAL BUDGET 2027', A => withSubtotals(A).totalCost, money, 'row-grand-total', 'style="font-weight:800"');
    html += `<tr><td colspan="${1 + colGetters.length}" style="text-align:right;padding-right:12px;color:var(--text-secondary);">Cost / Revenue Ratio</td><td class="cell-computed" style="font-weight:700">${ratioOf(mergedA).toFixed(1)}%</td>${colGetters.map(g => `<td class="cell-computed">${ratioOf(g).toFixed(1)}%</td>`).join('')}</tr>`;
    html += '</tbody>';

    table.innerHTML = html;

    // Cache 2D rows for export: two header rows (project + entity), then data rows
    const rows2d = [['Category', ...exportH1], ['', ...exportH2]];
    const pushRow = (label, getVal, isNum) => {
        const r = [label, isNum ? Math.round(getVal(mergedA)) : getVal(mergedA)];
        colGetters.forEach(g => r.push(isNum ? Math.round(getVal(g)) : getVal(g)));
        rows2d.push(r);
    };
    pushRow('Target Revenue', A => A.revenue);
    pushRow('Units Sold', A => A.units, true);
    pushRow('Sqm Sold', A => A.sqm, true);
    pushRow('Dev & Land Cost', A => A.devLand);
    pushRow('Sales Inhouse', A => A.salesInhouse);
    pushRow('Sales Agent', A => A.salesAgent);
    pushRow('Program Sales', A => A.salesProgram);
    pushRow('Marketing ATL', A => A.mktATL);
    pushRow('Marketing BTL', A => A.mktBTL);
    pushRow('Sales & Marketing Total', A => withSubtotals(A).salesMktg);
    pushRow('Payroll', A => A.payroll);
    pushRow('G&A (incl. Business Trip)', A => A.ga);
    pushRow('Others', A => A.others);
    pushRow('Finance', A => A.finance);
    pushRow('Tax', A => A.tax);
    pushRow('Corporate Event', A => A.corpEvent);
    pushRow('Employee & Operations Total', A => withSubtotals(A).empOps);
    pushRow('Capex (Fixed Assets)', A => A.capex);
    pushRow('TOTAL BUDGET 2027', A => withSubtotals(A).totalCost);
    rows2d.push(['Cost / Revenue Ratio (%)', parseFloat(ratioOf(mergedA).toFixed(1)), ...colGetters.map(g => parseFloat(ratioOf(g).toFixed(1)))]);
    const namePart = isDeptView
        ? 'Dept_' + (scopeLabel.split('—')[0].trim().replace(/\s+/g, '_'))
        : 'Consolidated_' + (state.selectedProject || '').replace(/\s+/g, '_');
    state.consolidatedExport = { filename: namePart + '_FY2027.xlsx', rows: rows2d, colCount: rows2d[0].length };
}

// Toggle per-project entity columns (Collins / Sequoia) in the All Projects view
function toggleProjectEntities(projectName) {
    if (!state.showProjectEntities) state.showProjectEntities = {};
    state.showProjectEntities[projectName] = state.showProjectEntities[projectName] === false;
    try { localStorage.setItem('budget_show_entities', JSON.stringify(state.showProjectEntities)); } catch (e) {}
    renderConsolidatedSummary('dept-summary');
}

async function exportConsolidatedSummary() {
    if (exportInFlight) return;
    exportInFlight = true;
    try {
        const data = state.consolidatedExport;
        if (!data) {
            showToast('Summary data not loaded yet. Open the summary tab first.', 'amber');
            return;
        }
        const infoLine = 'ENTITAS: ' + (state.selectedCompany || '') + '   |   PROJECT: ' + (state.selectedProject || '');
        const colCount = data.colCount || 14;
        await writeStyledWorkbook([{ name: 'Summary', title: 'CONSOLIDATED SUMMARY', infoLine, rows: data.rows, opts: { cols: [{ wch: 38 }, ...Array(Math.max(colCount - 1, 0)).fill({ wch: 18 })] } }], data.filename);
        showToast('Summary exported to Excel.', 'emerald');
    } catch (err) {
        console.error(err);
        showToast('Export error: ' + err.message, 'error');
    } finally {
        exportInFlight = false;
    }
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
    
    // Mock mode: browser-only data, never touch the backend
    if (state.mockMode) {
        const key = localDraftKey();
        const stored = localStorage.getItem(key);
        if (stored) {
            try { state.data = JSON.parse(stored); }
            catch (e) { state.data = generateMockBudget(); }
        } else {
            // Show generated data WITHOUT saving: visiting a selection must not create
            // a budget row (same as the live backend) — only explicit Saves persist
            state.data = generateMockBudget();
        }
        state.isDirty = false;
        updateSyncIndicator(true);
        switchTab(getActiveTabId());
        return;
    }
    
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
        const department = getActiveDepartment();
        const url = `${state.gasUrl}?action=get&company=${encodeURIComponent(state.selectedCompany)}&project=${encodeURIComponent(state.selectedProject)}&department=${encodeURIComponent(department || '')}`;
        const response = await fetchGasGet(url);
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

function isReadOnlyUser() {
    return state.currentUser && (state.currentUser.role === 'Viewer' || state.currentUser.role === 'FAT');
}

// Enable/disable the Save button according to the CURRENT effective user (incl. previews)
function syncSaveButton() {
    const saveBtn = document.getElementById('save-btn');
    if (!saveBtn) return;
    if (isReadOnlyUser()) {
        saveBtn.disabled = true;
        saveBtn.title = 'This role is read-only';
    } else {
        saveBtn.disabled = false;
        saveBtn.title = '';
    }
}

// Flip the Save button into a "Saving..." state while the POST is in flight,
// then restore it - keeps the user on their current tab the whole time.
function setSaveButtonState(saving) {
    const btn = document.getElementById('save-btn');
    if (!btn) return;
    if (saving) {
        btn.dataset.originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-circle" class="spin"></i> Saving...`;
    } else {
        btn.disabled = isReadOnlyUser();
        if (btn.dataset.originalHtml) {
            btn.innerHTML = btn.dataset.originalHtml;
            delete btn.dataset.originalHtml;
        }
        btn.title = isReadOnlyUser() ? 'This role is read-only' : '';
    }
    refreshIcons();
}

async function triggerDataSave() {
    if (!state.selectedCompany || !state.selectedProject) return;
    
    showToast('Saving budget planning to database...', 'info');
    setSaveButtonState(true);
    
    if (!state.gasUrl || state.mockMode) {
        // Save to local storage (mock mode = browser-only draft)
        saveLocalMockData();
        showToast(state.mockMode
            ? 'Saved mock draft locally (browser only).'
            : 'Saved local draft successfully (Link GAS backend for server database).', 'emerald');
        state.isDirty = false;
        updateSyncIndicator(true);
        setSaveButtonState(false);
        return;
    }
    
    try {
        const payload = {
            action: 'save',
            company: state.selectedCompany,
            project: state.selectedProject,
            department: getActiveDepartment() || '',
            // Real caller identity (survives "View as" previews) so the backend can
            // authorize: Admin may save any division; others only their own; Viewer/FAT rejected.
            callerNik: (state.realUser && state.realUser.employeeId) || (state.currentUser ? state.currentUser.employeeId : ''),
            data: state.data
        };
        
        const response = await fetchWithTimeout(state.gasUrl, {
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
    } finally {
        setSaveButtonState(false);
    }
}

// ---------------------------------------------------
// EXPORT TO XLSX
// Styled workbook writer (exceljs — SheetJS community build cannot write fills/fonts).
// Mirrors "Template Budget 2027_ OSYT.xlsx": dark-navy title band, gray info line,
// blue bold header row, #,##0 on numeric cells, bold light-filled totals rows.
async function writeStyledWorkbook(sheets, filename) {
    const wb = new ExcelJS.Workbook();
    wb.created = new Date();
    wb.creator = 'Triniti Budget';
    sheets.forEach(s => {
        const ws = wb.addWorksheet(s.name, { views: [{ state: 'frozen', ySplit: 3 }] });
        const colCount = Math.max((s.opts && s.opts.cols ? s.opts.cols.length : 14), 1);
        // Title band
        ws.mergeCells(1, 1, 1, colCount);
        const title = ws.getCell(1, 1);
        title.value = s.title;
        title.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 14 };
        title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF44546A' } };
        title.alignment = { vertical: 'middle', horizontal: 'left' };
        ws.getRow(1).height = 24;
        // Info line
        ws.mergeCells(2, 1, 2, colCount);
        const info = ws.getCell(2, 1);
        info.value = s.infoLine;
        info.font = { bold: true, size: 10, color: { argb: 'FF1F2937' } };
        info.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
        info.alignment = { vertical: 'middle', horizontal: 'left' };
        // Data rows (start at row 3)
        s.rows.forEach((row, ri) => {
            const xlRow = ws.getRow(ri + 3);
            row.forEach((val, ci) => {
                const cell = xlRow.getCell(ci + 1);
                cell.value = (val === '' || val === undefined || val === null) ? null : val;
                if (typeof val === 'number') cell.numFmt = '#,##0';
                if (ri === 0) {
                    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
                    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                }
                if (ri > 0 && typeof row[0] === 'string' && /total|grand|ytd|ratio/i.test(row[0])) {
                    cell.font = { bold: true };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECECEC' } };
                }
            });
        });
        // Column widths
        ((s.opts && s.opts.cols) || []).forEach((w, ci) => { ws.getColumn(ci + 1).width = (w && w.wch) || 12; });
    });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

// One export at a time (double-click / repeated clicks on async exports)
let exportInFlight = false;

async function exportBudget() {
    if (exportInFlight) return;
    exportInFlight = true;
    if (!state.selectedCompany || !state.selectedProject) {
        showToast('Select a company and project before exporting.', 'amber');
        exportInFlight = false;
        return;
    }
    showToast('Building Excel file...', 'info');
    try {
        const sheets = [];
        const addSheet = (name, title, rows, opts) => sheets.push({ name, title, infoLine, rows, opts });
        const d = state.data;
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const fs = (n) => Math.round(n).toLocaleString('id-ID');
        const fshort = (n) => 'Rp ' + (n/1000000000).toFixed(2) + ' Bio';
        const infoLine = 'ENTITAS: ' + state.selectedCompany + '   |   PROJECT: ' + state.selectedProject;

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
            addSheet('Target Revenue', 'TARGET MARKETING REVENUE', rows, { cols: [{wch:20},{wch:10},{wch:10},{wch:10},{wch:8},{wch:14},...Array(12).fill({wch:12})] });
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
            addSheet('Sales Cost', 'BUDGET SALES COST', rows, { cols: [{wch:22},{wch:14},...Array(12).fill({wch:12})] });
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
            addSheet('Program Sales', 'BUDGET PROGRAM SALES', rows, { cols: [{wch:24},{wch:14},...Array(12).fill({wch:12})] });
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
            addSheet('Marketing', 'BUDGET MARKETING ACTIVITY', rows, { cols: [{wch:40},{wch:18},{wch:14},...Array(12).fill({wch:12})] });
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
            addSheet('Dev & Land', 'DEV & LAND BUDGET PLAN COST', rows, { cols: [{wch:6},{wch:24},{wch:8},{wch:10},{wch:14},{wch:14},{wch:14},{wch:8},{wch:14},...Array(12).fill({wch:12})] });
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
            addSheet('Payroll', 'BUDGET PAYROLL', rows, { cols: [{wch:12},{wch:42},{wch:14},...Array(12).fill({wch:12})] });
        })();

        // --- 7. Expenses (GA, Others, Finance, Tax) ---
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
            addSheet(label, 'BUDGET ' + label.toUpperCase(), rows, { cols: [{wch:14},{wch:42},{wch:14},...Array(12).fill({wch:12})] });
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
            addSheet('Corporate Event', 'BUDGET CORPORATE EVENT & EXHIBITION', rows, { cols: [{wch:36},{wch:16},{wch:6},{wch:12},{wch:14},{wch:14},...Array(12).fill({wch:12})] });
        })();

        // --- 10. Fixed Assets ---
        (() => {
            const rows = [['Division','Category','Description','Type','Qty','Price/Unit','Total','Month','Justification']];
            (d.fixed_assets||[]).forEach(r => {
                rows.push([r.division,r.category,r.desc,r.new_replace,r.qty,r.price,r.qty*r.price,months[r.month],r.justification]);
            });
            addSheet('Fixed Assets', 'FIXED ASSET', rows, { cols: [{wch:14},{wch:26},{wch:30},{wch:10},{wch:6},{wch:14},{wch:18},{wch:8},{wch:14}] });
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
            addSheet('Business Trip', 'BUSINESS TRIP', rows, { cols: [{wch:18},{wch:14},{wch:10},{wch:10},{wch:14},{wch:8},{wch:8},{wch:14},{wch:14},{wch:14},{wch:18}] });
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

            addSheet('SUMMARY BUDGET', 'SUMMARY BUDGET', rows, { cols: [{wch:38},{wch:18},{wch:18},{wch:22},{wch:18},{wch:16},{wch:16}] });
        })();

        // Write styled workbook (template colors: navy title, blue header, #,##0 numbers)
        const fname = `Budget_${state.selectedCompany}_${state.selectedProject}_FY2027.xlsx`.replace(/[^a-zA-Z0-9_\-\.]/g,'_');
        await writeStyledWorkbook(sheets, fname);
        showToast('Excel file exported successfully!', 'emerald');
    } catch (err) {
        console.error(err);
        showToast('Export error: ' + err.message, 'error');
    } finally {
        exportInFlight = false;
    }
}

// ----------------------------------------------------
// MOCK DATA MODE (browser-only, no backend) + ROLE PREVIEW (super admin)
// ----------------------------------------------------
// Deterministic pseudo-random generator (seeded by string) so mock data is stable
function seededRand(seedStr) {
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) {
        h ^= seedStr.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return function () {
        h = Math.imul(h ^ (h >>> 15), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    };
}

// Build a realistic full budget for the current project/division
function generateMockBudget(seedOverride) {
    const seed = seedOverride || (state.selectedProject || 'Demo') + '|' + (getActiveDepartment() || '');
    const rnd = seededRand(seed);
    const d = getInitialDataStructure();
    const monthRamp = (base, jitter) => Array.from({ length: 12 }, (_, m) =>
        Math.round((base * (0.6 + m * 0.08) * (1 + (rnd() - 0.5) * jitter)) / 1000) * 1000);

    // Target revenue: monthly units ramp + sqm
    d.target_revenue.forEach(row => {
        const baseUnits = Math.max(1, Math.round(row.stock_units / 8));
        row.units = Array.from({ length: 12 }, (_, m) => Math.max(0, Math.round(baseUnits * (0.5 + m * 0.09) * (0.7 + rnd() * 0.6))));
        row.sqm = row.units.map(u => u * Math.round(row.stock_sqm / row.stock_units));
    });

    // Sales cost as % of monthly revenue
    const monthlyRev = d.target_revenue.reduce((acc, r) => {
        r.sqm.forEach((s, m) => { acc[m] += s * r.price_sqm; });
        return acc;
    }, Array(12).fill(0));
    const pct = (p) => monthlyRev.map(v => Math.round(v * p / 1000) * 1000);
    d.sales_cost.inhouse.komisi = pct(0.025);
    d.sales_cost.inhouse.closing_fee = pct(0.005);
    d.sales_cost.inhouse.or = pct(0.004);
    d.sales_cost.inhouse.reward = pct(0.002);
    d.sales_cost.agent.komisi = pct(0.03);
    d.sales_cost.agent.closing_fee = pct(0.006);
    d.sales_cost.agent.or = pct(0.005);
    d.sales_cost.agent.reward = pct(0.002);
    Object.keys(d.program_sales).filter(k => !k.startsWith('_')).forEach(k => {
        d.program_sales[k] = pct(0.004 + rnd() * 0.006);
    });

    // Marketing activity from templates (ATL rows < 46, BTL >= 46)
    (state.templates.marketing || []).forEach(item => {
        if (item.type === 'input') {
            const base = item.row < 46 ? 30000000 : 15000000;
            d.marketing_activity[item.row] = monthRamp(base, 0.5);
        }
    });

    // Dev & Land from templates
    (state.templates.dev_land || []).forEach(item => {
        if (item.num && item.num.includes('.')) {
            d.dev_land[item.row] = {
                sqm: item.sqm || 0,
                cost_sqm: item.cost_sqm || 0,
                rab_spk: item.rab_spk || 5000000000,
                realisasi: item.realisasi || 0,
                best_est: item.best_est || 0,
                monthly: monthRamp((item.rab_spk || 5000000000) / 12 / 4, 0.6)
            };
        }
    });

    // Payroll / GA / Others / Finance / Tax
    const fillExpense = (target, template, base) => {
        (template || []).forEach(acc => {
            target[acc.code] = monthRamp(base * (0.6 + rnd() * 0.9), 0.4);
        });
    };
    fillExpense(d.payroll_expenses, state.templates.payroll, 60000000);
    fillExpense(d.ga_expenses, state.templates.ga, 25000000);
    fillExpense(d.others_expenses, state.templates.others, 20000000);
    fillExpense(d.finance_expenses, state.templates.finance, 15000000);
    fillExpense(d.tax_expenses, state.templates.tax, 40000000);

    // Corporate events (one-off in a random month)
    (state.templates.corp_event || []).forEach(item => {
        if (item.type === 'input') {
            const qty = Math.max(1, Math.round(rnd() * 3));
            const price = 25000000 + Math.round(rnd() * 4) * 25000000;
            d.corp_events[item.row] = { qty, price_unit: price, monthly: Array(12).fill(0) };
            d.corp_events[item.row].monthly[Math.floor(rnd() * 12)] = qty * price;
        }
    });

    // Fixed assets
    d.fixed_assets = [
        { id: 'mock_fa1', category: 'IT Equipment', desc: 'Laptop & Workstation', division: getActiveDepartment() || 'IT', justification: 'Replace aging fleet', new_replace: 'New', qty: 10, price: 18000000, month: 1 },
        { id: 'mock_fa2', category: 'IT Equipment', desc: 'Server & Network', division: getActiveDepartment() || 'IT', justification: 'HQ upgrade', new_replace: 'Replace', qty: 2, price: 120000000, month: 3 },
        { id: 'mock_fa3', category: 'Furniture & Fittings', desc: 'Office Furniture', division: getActiveDepartment() || 'GA', justification: 'New office fit-out', new_replace: 'New', qty: 25, price: 4500000, month: 2 }
    ];

    // Business trips
    d.business_trip = [
        { id: 'mock_t1', employee: 'Sales Executive', grade: 'Staff', destination: 'Local', city: 'Bandung', division: getActiveDepartment() || 'SALES', duration: 3, month: 2 },
        { id: 'mock_t2', employee: 'Project Manager', grade: 'Manager', destination: 'Local', city: 'Surabaya', division: getActiveDepartment() || 'PROJECT', duration: 4, month: 4 },
        { id: 'mock_t3', employee: 'Finance Director', grade: 'Director', destination: 'Overseas', city: 'Singapore', division: getActiveDepartment() || 'CORFIN', duration: 6, month: 6 },
        { id: 'mock_t4', employee: 'Marketing SPV', grade: 'SPV', destination: 'Local', city: 'Bali', division: getActiveDepartment() || 'MARKETING', duration: 2, month: 8 }
    ];

    d.summary_2026 = {};
    return d;
}

function loadMockData() {
    state.mockMode = true;
    seedMockDrafts();
    const key = localDraftKey();
    const stored = localStorage.getItem(key);
    if (stored) {
        try { state.data = JSON.parse(stored); }
        catch (e) { state.data = generateMockBudget(); }
    } else {
        // Fall back to the first seeded draft so the mock DB is always populated.
        // NOT saved to the current selection key: only an explicit Save persists there
        // (visiting a selection must not create a budget row).
        const firstKey = MOCK_SEED_ROWS.map(r => 'draft_' + [r[0], r[1], r[2]].map(encodeURIComponent).join('~'))[0];
        const first = localStorage.getItem(firstKey);
        state.data = first ? JSON.parse(first) : generateMockBudget();
    }
    state.isDirty = false;
    updateSyncIndicator(true);
    updateMockButton();
    switchTab(getActiveTabId());
    showToast('Mock data loaded — browser only, no backend touched.', 'emerald');
}

function exitMockMode() {
    state.mockMode = false;
    state.isDirty = false;
    updateSyncIndicator(true);
    updateMockButton();
    showToast('Back to live backend data.', 'info');
    triggerDataLoad();
}

function toggleMockMode() {
    if (state.mockMode) exitMockMode();
    else loadMockData();
}

function updateMockButton() {
    const btn = document.getElementById('mock-btn');
    if (!btn) return;
    if (state.mockMode) {
        btn.innerHTML = `<i data-lucide="plug-zap"></i> Live`;
        btn.title = 'Exit mock data and return to the live backend';
    } else {
        btn.innerHTML = `<i data-lucide="flask-conical"></i> Mock`;
        btn.title = 'Load browser-only sample data (no backend)';
    }
    refreshIcons();
}

// ---- Super admin "View as" role preview ----
function getDivisionRecord(name) {
    return state.departments.find(d => d.department === name) || null;
}

function applyPreviewRole(role) {
    if (!role) { exitPreview(); return; }
    if (!state.realUser) {
        state.realUser = JSON.parse(sessionStorage.getItem('current_user_v2') || 'null') || state.currentUser;
    }
    const base = state.realUser;
    const divName = state.selectedDepartment || (state.departments[0] && state.departments[0].department) || '';
    const div = getDivisionRecord(divName);
    const mods = div ? div.allowedModules : 'ALL';
    const projs = div ? div.allowedProjects : 'ALL';
    const comps = div ? div.allowedCompanies : 'ALL';

    let preview;
    if (role === 'Admin') {
        preview = { ...base, role: 'Admin', department: '', allowedProjects: 'ALL', allowedCompanies: 'ALL', allowedModules: 'ALL', deptAllowedProjects: 'ALL', deptAllowedCompanies: 'ALL' };
    } else if (role === 'DeptHead') {
        preview = { ...base, role: 'DeptHead', department: divName, allowedProjects: projs, allowedCompanies: comps, allowedModules: mods, deptAllowedProjects: projs, deptAllowedCompanies: comps };
    } else if (role === 'User') {
        preview = { ...base, role: 'User', department: divName, allowedProjects: projs, allowedCompanies: comps, allowedModules: mods, deptAllowedProjects: projs, deptAllowedCompanies: comps };
    } else if (role === 'FAT') {
        preview = { ...base, role: 'FAT', department: '', allowedProjects: 'ALL', allowedCompanies: 'ALL', allowedModules: 'ALL', deptAllowedProjects: 'ALL', deptAllowedCompanies: 'ALL' };
    } else if (role === 'Viewer') {
        preview = { ...base, role: 'Viewer', department: divName, allowedProjects: projs, allowedCompanies: comps, allowedModules: mods, deptAllowedProjects: projs, deptAllowedCompanies: comps };
    } else {
        return;
    }

    state.currentUser = preview;
    // Non-admin previews don't see the division switcher
    const deptSelGroup = document.getElementById('dept-selector-group');
    if (deptSelGroup) deptSelGroup.style.display = (role === 'Admin') ? 'flex' : 'none';
    applyModuleVisibility();
    syncSaveButton();
    initDropdowns();
    triggerDataLoad();

    const roleLabel = { Admin: 'Super Admin', DeptHead: 'Dept Head', FAT: 'FAT Manager' }[role] || role;
    const banner = document.getElementById('preview-banner');
    if (banner) {
        document.getElementById('preview-banner-text').innerText = roleLabel + ((role !== 'FAT' && role !== 'Admin' && divName) ? ' — ' + divName : '');
        banner.style.display = 'flex';
    }
    showToast('Previewing as ' + roleLabel + ((role !== 'FAT' && role !== 'Admin' && divName) ? ' (' + divName + ')' : '') + '.', 'info');
}

function exitPreview() {
    if (!state.realUser) {
        const sel = document.getElementById('viewas-select');
        if (sel) sel.value = '';
        return;
    }
    state.currentUser = state.realUser;
    state.realUser = null;
    const deptSelGroup = document.getElementById('dept-selector-group');
    if (deptSelGroup) deptSelGroup.style.display = 'flex';
    applyModuleVisibility();
    syncSaveButton();
    initDropdowns();
    triggerDataLoad();
    const banner = document.getElementById('preview-banner');
    if (banner) banner.style.display = 'none';
    const sel = document.getElementById('viewas-select');
    if (sel) sel.value = '';
    showToast('Preview ended. Back to your account.', 'info');
}

// Local mock data handlers — draft key is scoped by division so two departments
// sharing a project never see each other's browser drafts
function localDraftKey() {
    return 'draft_' + [state.selectedCompany, state.selectedProject, getActiveDepartment() || ''].map(encodeURIComponent).join('~');
}

// Reverse of localDraftKey: { company, project, dept } for a 'draft_...' localStorage key
function parseDraftKey(key) {
    const parts = key.slice(6).split('~').map(decodeURIComponent);
    return { company: parts[0] || '', project: parts[1] || '', dept: parts[2] || '' };
}

// Mock-mode "database": one browser-only draft per (company, project, division).
// Company-project pairs follow the REAL projectCompanyMapping in metadata.json.
// Mirrors the rows seeded in the local QA mock server so the consolidated views
// show ALL projects/divisions while in mock mode (never touches the backend).
const MOCK_SEED_ROWS = [
    ['PT Puri Triniti Batam', 'Marcs Boulevard', 'SALES'],
    ['PT Puri Triniti Batam', 'Marcs Boulevard', 'MARKETING'],
    ['PT Puri Triniti Batam', 'Marcs Boulevard', 'IT'],
    ['PT Puri Triniti Batam', 'Marcs Boulevard', 'PROC'],
    ['PT Puri Triniti Batam', 'Marcs Boulevard', 'QS'],
    ['PT Triniti Menara Gading', 'Collins Boulevard', 'SALES'],
    ['PT Triniti Menara Serpong', 'Collins Boulevard', 'SALES'],
    ['PT Triniti Menara Gading', 'Collins Boulevard', 'LEGAL'],
    ['PT Triniti Menara Gading', 'Collins Boulevard', 'HC&GA'],
    ['JO Triniti Sentul', 'Sequoia Hills', 'SALES'],
    ['PT Triniti Garam Properti', 'Sequoia Hills', 'SALES'],
    ['JO Triniti Sentul', 'Sequoia Hills', ''],
    ['PT Triniti Dinamik', 'District East', 'COO'],
    ['PT Triniti Dinamik', 'District East', 'CORSEC'],
    ['PT Triniti Dinamik', 'District East', 'GCR'],
    ['PT Triniti Dinamik', 'District East', 'TECHPLAN'],
    ['PT Perintis Triniti Properti Tbk - Lampung', 'Holdwell Business Park', 'COLL'],
    ['PT Perintis Triniti Properti Tbk - Lampung', 'Holdwell Business Park', 'FAT'],
    ['PT Perintis Triniti Properti Tbk - Lampung', 'Holdwell Business Park', 'PAYROLL'],
    ['PT Perintis Triniti Properti Tbk - Lampung', 'Holdwell Business Park', 'PROJECT'],
    ['4P', 'SW & TS', 'BOD'],
    ['PT Perintis Triniti Properti Tbk', 'Head Office', 'CORFIN']
];

function seedMockDrafts() {
    // One-time migration: if the seed version marker is missing, drop stale drafts
    // (e.g. rows seeded under wrong company-project pairs) before reseeding.
    if (!localStorage.getItem('budget_mock_seed_v3')) {
        const stale = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf('draft_') === 0) stale.push(k);
        }
        stale.forEach(k => localStorage.removeItem(k));
        localStorage.setItem('budget_mock_seed_v3', '1');
    }
    const keys = [];
    MOCK_SEED_ROWS.forEach(([company, project, dept]) => {
        const key = 'draft_' + [company, project, dept].map(encodeURIComponent).join('~');
        if (localStorage.getItem(key)) { keys.push(key); return; }
        const d = generateMockBudget(project + '|' + dept);
        // Back-office divisions (everything except SALES/MARKETING) carry no revenue:
        // zero the sales-side modules so their columns show costs only (ratio 0.0%)
        if (dept !== 'SALES' && dept !== 'MARKETING') {
            d.target_revenue.forEach(row => { row.units = Array(12).fill(0); row.sqm = Array(12).fill(0); });
            d.marketing_activity = {};
        }
        localStorage.setItem(key, JSON.stringify(d));
        keys.push(key);
    });
    return keys;
}

function loadLocalMockData() {
    const key = localDraftKey();
    const stored = localStorage.getItem(key);
    if (stored) {
        state.data = JSON.parse(stored);
    } else {
        state.data = getInitialDataStructure();
        initDefaultDynamicData();
    }
}

function saveLocalMockData() {
    const key = localDraftKey();
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
    
    if (state.mockMode) {
        dot.className = 'indicator-dot unsynced';
        text.innerText = 'Mock Mode';
        return;
    }
    
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
    const modal = document.getElementById('gas-config-modal');
    modal.style.display = 'flex';
    document.getElementById('gas-url-input').value = state.gasUrl;
}

function hideGasConfigModal() {
    document.getElementById('gas-config-modal').style.display = 'none';
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
            const res = await fetchGasGet(url);
            const json = await res.json();
            
            if (json.status === 'success' && json.user) {
                setAuthenticatedUser(json.user);
            } else {
                showToast('Invalid NIK or not authorized for 2027 budget planner.', 'error');
            }
        } catch (err) {
            // Timeout/offline: fall back to local login (still lets the app run standalone)
            if (!isAbortError(err)) console.error(err);
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
        role: nikInput.toLowerCase() === '1001' ? 'Admin' : 'User',
        department: '',
        allowedModules: 'ALL',
        deptAllowedProjects: 'ALL',
        deptAllowedCompanies: 'ALL'
    };
    setAuthenticatedUser(user);
}

async function fetchDepartmentsList() {
    if (!state.gasUrl) return;
    try {
        const res = await fetchGasGet(`${state.gasUrl}?action=listDepartments`);
        const json = await res.json();
        if (json.status === 'success' && Array.isArray(json.data)) {
            state.departments = json.data;
        }
    } catch (err) {
        if (!isAbortError(err)) console.error(err);
    }
}

function populateDeptSelector() {
    const deptSel = document.getElementById('dept-select');
    if (!deptSel) return;
    const depts = state.departments.map(d => d.department);
    if (depts.length === 0) {
        deptSel.innerHTML = `<option value="">No divisions yet</option>`;
        return;
    }
    deptSel.innerHTML = depts.map(d => `<option value="${d}">${d}</option>`).join('');
    // Keep previous selection if still valid, else first dept
    if (depts.includes(state.selectedDepartment)) {
        deptSel.value = state.selectedDepartment;
    } else {
        state.selectedDepartment = depts[0];
        deptSel.value = state.selectedDepartment;
    }
}

async function setAuthenticatedUser(user) {
    state.currentUser = user;
    sessionStorage.setItem('current_user_v2', JSON.stringify(user));
    
    document.getElementById('user-display-name').innerText = user.name || user.employeeId;
    const deptTag = user.department ? ` • ${user.department}` : '';
    document.getElementById('user-display-nik').innerText = `NIK: ${user.employeeId} (${user.role})${deptTag}`;
    
    hideNikLoginModal();
    showToast(`Welcome ${user.name}! NIK verified.`, 'emerald');
    
    // Super admin: load departments & show dept switcher to review each department's entries
    const deptSelectorGroup = document.getElementById('dept-selector-group');
    if (deptSelectorGroup) {
        if (isSuperAdmin()) {
            deptSelectorGroup.style.display = 'flex';
            await fetchDepartmentsList();
            populateDeptSelector();
        } else {
            deptSelectorGroup.style.display = 'none';
            state.selectedDepartment = user.department || '';
        }
    }
    
    // Role-based sidebar visibility (admin tabs + department module access)
    applyModuleVisibility();
    
    // Restore the tab the user was on before (e.g. after a page refresh/reload)
    const savedTab = sessionStorage.getItem('budget_active_tab');
    if (savedTab && isTabAllowed(savedTab)) {
        switchTab(savedTab);
    }
    
    // Viewer & FAT roles = read-only
    syncSaveButton();
    
    // Mock & View-as controls: super admin only
    const mockBtn = document.getElementById('mock-btn');
    if (mockBtn) mockBtn.style.display = isSuperAdmin() ? 'inline-flex' : 'none';
    const viewasSel = document.getElementById('viewas-select');
    if (viewasSel) viewasSel.style.display = isSuperAdmin() ? 'inline-block' : 'none';
    updateMockButton();
    
    initDropdowns();
    triggerDataLoad();
}

function handleNikLogout() {
    state.currentUser = null;
    state.departments = [];
    state.selectedDepartment = '';
    state.mockMode = false;
    state.realUser = null;
    sessionStorage.removeItem('current_user_v2');
    document.getElementById('user-display-name').innerText = 'Not Signed In';
    document.getElementById('user-display-nik').innerText = 'NIK: -';
    
    // Reset admin-only UI
    const deptSelectorGroup = document.getElementById('dept-selector-group');
    if (deptSelectorGroup) deptSelectorGroup.style.display = 'none';
    const mockBtn = document.getElementById('mock-btn');
    if (mockBtn) { mockBtn.style.display = 'none'; updateMockButton(); }
    const viewasSel = document.getElementById('viewas-select');
    if (viewasSel) { viewasSel.style.display = 'none'; viewasSel.value = ''; }
    const banner = document.getElementById('preview-banner');
    if (banner) banner.style.display = 'none';
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) saveBtn.disabled = false;
    
    showToast('Signed out successfully.', 'info');
    showNikLoginModal();
}

// ----------------------------------------------------
// NIK MANAGEMENT UI (SUPER ADMIN + DEPT HEAD)
// ----------------------------------------------------
function roleBadgeClass(role) {
    switch (role) {
        case 'Admin': return 'badge-amber';
        case 'DeptHead': return 'badge-purple';
        case 'FAT': return 'badge-cherry';
        case 'Viewer': return 'badge-emerald';
        default: return 'badge-indigo';
    }
}

async function renderNikManagementTable() {
    const tbody = document.getElementById('nik-management-body');
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:24px; color:var(--text-secondary);">Loading employee access list...</td></tr>`;
    
    const subtitle = document.getElementById('nik-mgmt-subtitle');
    if (subtitle) {
        if (isDeptHead()) {
            subtitle.innerText = `You manage the ${state.currentUser.department} team. Your team members can only be assigned to projects within this division's scope, and they can only see entries from ${state.currentUser.department}.`;
        } else {
            subtitle.innerText = 'Manage employee NIKs, divisions, and roles. Employees can only access budget entries for their division and authorized projects.';
        }
    }
    
    if (state.gasUrl) {
        try {
            // Dept heads only see their own team
            const deptParam = isDeptHead() ? `&department=${encodeURIComponent(state.currentUser.department || '')}` : '';
            const res = await fetchGasGet(`${state.gasUrl}?action=listEmployees${deptParam}`);
            const json = await res.json();
            if (json.status === 'success' && Array.isArray(json.data)) {
                state.nikList = json.data;
            }
        } catch (err) {
            if (!isAbortError(err)) console.error(err);
        }
    }
    
    // A dept head without a department has no team scope - show empty state instead of all users
    if (isDeptHead() && !state.currentUser.department) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:24px; color:var(--text-secondary);">Your account has no division assigned. Ask a super admin to assign you to a division.</td></tr>`;
        return;
    }
    
    if (!state.nikList || state.nikList.length === 0) {
        state.nikList = [
            { employeeId: '1001', name: 'Administrator', allowedProjects: 'ALL', allowedCompanies: 'ALL', role: 'Admin', department: '' }
        ];
    }
    
    tbody.innerHTML = state.nikList.map((emp, idx) => {
        const isSelf = state.currentUser && emp.employeeId === state.currentUser.employeeId;
        // Dept heads may only manage plain User/Viewer rows — editing a DeptHead/FAT/Admin
        // row would silently demote it (role select only offers User/Viewer).
        const isProtected = (emp.role === 'Admin' && !isSuperAdmin()) || (isDeptHead() && emp.role !== 'User' && emp.role !== 'Viewer');
        return `
        <tr>
            <td><strong style="font-family:monospace;">${esc(emp.employeeId)}</strong></td>
            <td>${esc(emp.name || '-')}</td>
            <td>${emp.department ? `<span class="badge badge-indigo">${esc(emp.department)}</span>` : '<span class="badge">Unassigned</span>'}</td>
            <td><span class="badge ${emp.allowedProjects === 'ALL' ? 'badge-emerald' : 'badge-purple'}">${esc(emp.allowedProjects)}</span></td>
            <td><span class="badge ${emp.allowedCompanies === 'ALL' ? 'badge-emerald' : 'badge-indigo'}">${esc(emp.allowedCompanies)}</span></td>
            <td><span class="badge ${roleBadgeClass(emp.role)}">${esc(emp.role)}</span></td>
            <td>${emp.createdAt ? String(emp.createdAt).substring(0, 10) : '-'}</td>
            <td class="action-cell">
                ${isProtected ? '' : `<button class="btn-icon-sm" onclick="showNikEditModal('${esc(emp.employeeId)}')" title="Edit Employee"><i data-lucide="pencil"></i></button>`}
                ${(isProtected || isSelf) ? '' : `<button class="btn-delete" onclick="deleteNikPermission('${esc(emp.employeeId)}')" title="Revoke Access"><i data-lucide="trash-2"></i></button>`}
            </td>
        </tr>
    `}).join('');
    
    refreshIcons();
}

function showNikEditModal(empId) {
    const emp = empId ? state.nikList.find(e => e.employeeId === empId) : null;
    
    // Department options: super admin sees all; dept head locked to their own
    const deptSel = document.getElementById('nik-edit-dept');
    const isDeptHeadUser = isDeptHead();
    if (isDeptHeadUser) {
        deptSel.innerHTML = `<option value="${state.currentUser.department || ''}">${state.currentUser.department || 'No Division'}</option>`;
        deptSel.disabled = true;
    } else {
        deptSel.disabled = false;
        const deptOptions = state.departments.map(d => d.department);
        deptSel.innerHTML = `<option value="">-- No Division --</option>` +
            deptOptions.map(d => `<option value="${d}">${d}</option>`).join('');
    }
    
    // Role options: dept head can only create User/Viewer
    const roleSel = document.getElementById('nik-edit-role');
    if (isDeptHeadUser) {
        roleSel.innerHTML = `
            <option value="User">User</option>
            <option value="Viewer">Viewer</option>`;
    } else {
        roleSel.innerHTML = `
            <option value="User">User</option>
            <option value="DeptHead">Dept Head</option>
            <option value="FAT">FAT Manager</option>
            <option value="Viewer">Viewer</option>
            <option value="Admin">Super Admin</option>`;
    }
    
    document.getElementById('nik-edit-id').value = emp ? emp.employeeId : '';
    document.getElementById('nik-edit-name').value = emp ? (emp.name || '') : '';
    deptSel.value = emp ? (emp.department || '') : (isDeptHeadUser ? state.currentUser.department || '' : '');
    roleSel.value = emp ? (emp.role || 'User') : 'User';
    
    // Project & company checkbox grids
    state.nikEditEmp = emp || null;
    state.nikCompanyOverrides = {};
    buildNikProjectCheckboxes(emp);
    
    // ID locked when editing
    document.getElementById('nik-edit-id').readOnly = !!emp;
    
    document.getElementById('nik-edit-modal').style.display = 'flex';
}

// Populate project checkboxes (admin: all projects; dept head: department scope only)
function buildNikProjectCheckboxes(emp) {
    const container = document.getElementById('nik-project-checkboxes');
    if (!container) return;
    
    let availableProjs = state.metadata.projects;
    let deptScope = null;
    if (isDeptHead()) {
        deptScope = parseCsvList(state.currentUser.deptAllowedProjects || 'ALL');
        if (deptScope.length > 0 && deptScope[0] !== 'ALL') {
            availableProjs = state.metadata.projects.filter(p => deptScope.some(d => d.toLowerCase() === p.toLowerCase()));
        }
    }
    
    // Pre-check: emp's projects, or default to all available projects in division scope
    let checked = [];
    if (emp) {
        checked = emp.allowedProjects === 'ALL' ? availableProjs : parseCsvList(emp.allowedProjects);
    } else {
        checked = availableProjs;
    }
    
    container.innerHTML = availableProjs.map(p => `
        <label class="checkbox-label" style="display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer;">
            <input type="checkbox" name="nik-project" value="${p}" ${checked.some(c => c.toLowerCase() === p.toLowerCase()) ? 'checked' : ''} onchange="syncNikCompanyCheckboxes()">
            <span>${p}</span>
        </label>
    `).join('');
    
    // Seed company overrides when editing someone with a specific company list
    state.nikCompanyOverrides = {};
    if (emp && emp.allowedCompanies && emp.allowedCompanies !== 'ALL') {
        const empComps = parseCsvList(emp.allowedCompanies).map(c => c.toLowerCase());
        const checkedProjects = Array.from(document.querySelectorAll('input[name="nik-project"]:checked')).map(cb => cb.value);
        const derived = [];
        checkedProjects.forEach(proj => {
            ((state.metadata.projectCompanyMapping || {})[proj] || []).forEach(c => { if (!derived.includes(c)) derived.push(c); });
        });
        derived.forEach(c => {
            if (!empComps.includes(c.toLowerCase())) state.nikCompanyOverrides[c] = false;
        });
    }
    
    syncNikCompanyCheckboxes();
}

// Company checkboxes: auto-derived from the currently checked projects
function syncNikCompanyCheckboxes() {
    const container = document.getElementById('nik-company-checkboxes');
    if (!container) return;
    
    const checkedProjects = Array.from(document.querySelectorAll('input[name="nik-project"]:checked')).map(cb => cb.value);
    let availableComps = [];
    checkedProjects.forEach(proj => {
        ((state.metadata.projectCompanyMapping || {})[proj] || []).forEach(c => { if (!availableComps.includes(c)) availableComps.push(c); });
    });
    if (availableComps.length === 0) availableComps = state.metadata.companies; // fallback when nothing selected
    
    const overrides = state.nikCompanyOverrides || {};
    container.innerHTML = availableComps.map(c => {
        const isChecked = overrides[c] !== undefined ? overrides[c] : true;
        return `
        <label class="checkbox-label" style="display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer;">
            <input type="checkbox" name="nik-company" value="${c}" ${isChecked ? 'checked' : ''} onchange="recordNikCompanyOverride(this)">
            <span>${c}</span>
        </label>
    `;
    }).join('');
}

// Remember manual company toggles so they survive project re-syncs within the modal session
function recordNikCompanyOverride(cb) {
    state.nikCompanyOverrides = state.nikCompanyOverrides || {};
    state.nikCompanyOverrides[cb.value] = cb.checked;
}

function hideNikEditModal() {
    document.getElementById('nik-edit-modal').style.display = 'none';
}

async function saveNikPermissions() {
    const empId = document.getElementById('nik-edit-id').value.trim();
    const name = document.getElementById('nik-edit-name').value.trim();
    const role = document.getElementById('nik-edit-role').value;
    let department = document.getElementById('nik-edit-dept').value;
    
    if (!empId) {
        showToast('Employee NIK ID is required.', 'amber');
        return;
    }
    
    // Dept head: force their own department & never escalate roles
    if (isDeptHead()) {
        department = state.currentUser.department || '';
        if (role === 'Admin' || role === 'DeptHead' || role === 'FAT' || role === '') {
            showToast('Dept heads can only create/manage User/Viewer accounts.', 'amber');
            return;
        }
    }
    
    // Read selected projects from checkboxes
    const projBoxes = document.querySelectorAll('input[name="nik-project"]');
    const projChecked = document.querySelectorAll('input[name="nik-project"]:checked');
    const selectedProjects = Array.from(projChecked).map(cb => cb.value);
    
    let finalProjsStr = 'ALL';
    if (isDeptHead()) {
        const deptScope = parseCsvList(state.currentUser.deptAllowedProjects || 'ALL');
        if (selectedProjects.length === 0) {
            showToast('Select at least one project within your division scope.', 'amber');
            return;
        }
        // If Dept Head checked all boxes or 'ALL', explicitly list out their division's projects
        if (projBoxes.length === 0 || selectedProjects.length === projBoxes.length) {
            finalProjsStr = deptScope.length > 0 && deptScope[0] !== 'ALL' ? deptScope.join(',') : selectedProjects.join(',');
        } else {
            finalProjsStr = selectedProjects.join(',');
        }
    } else {
        finalProjsStr = (projBoxes.length === 0 || selectedProjects.length === 0 || selectedProjects.length === projBoxes.length)
            ? 'ALL' : selectedProjects.join(',');
    }
    
    // Read selected companies from checkboxes
    const compBoxes = document.querySelectorAll('input[name="nik-company"]');
    const compChecked = document.querySelectorAll('input[name="nik-company"]:checked');
    const selectedComps = Array.from(compChecked).map(cb => cb.value);
    const allowedCompsStr = (compBoxes.length === 0 || selectedComps.length === 0 || selectedComps.length === compBoxes.length)
        ? 'ALL' : selectedComps.join(',');
    
    const payload = {
        action: 'addEmployee',
        employeeId: empId,
        name: name || 'Employee',
        allowedProjects: finalProjsStr,
        allowedCompanies: allowedCompsStr,
        role: role,
        department: department || '',
        callerNik: state.currentUser ? state.currentUser.employeeId : ''
    };
    
    showToast('Saving employee permissions...', 'info');
    
    if (state.gasUrl) {
        try {
            await fetchWithTimeout(state.gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
            showToast('Employee permissions saved successfully to Google Sheets.', 'emerald');
        } catch (err) {
            if (!isAbortError(err)) console.error(err);
            showToast('Saved employee locally.', 'amber');
        }
    } else {
        showToast('Saved employee access rules.', 'emerald');
    }
    
    // Update local state
    const existingIdx = state.nikList.findIndex(e => e.employeeId === empId);
    const newRecord = { employeeId: empId, name: name || 'Employee', allowedProjects: finalProjsStr, allowedCompanies: allowedCompsStr, role: role, department: department || '' };
    if (existingIdx >= 0) state.nikList[existingIdx] = newRecord;
    else state.nikList.push(newRecord);
    
    hideNikEditModal();
    renderNikManagementTable();
}

async function deleteNikPermission(empId) {
    if (!confirm(`Revoke access for ${empId}?`)) return;
    if (isDeptHead() && state.currentUser && empId === state.currentUser.employeeId) {
        showToast('You cannot delete your own account.', 'amber');
        return;
    }
    
    showToast('Revoking employee access...', 'info');
    
    if (state.gasUrl) {
        try {
            const payload = {
                action: 'deleteEmployee',
                employeeId: empId,
                callerNik: state.currentUser ? state.currentUser.employeeId : ''
            };
            await fetchWithTimeout(state.gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
            showToast('Employee access revoked from Google Sheets.', 'emerald');
        } catch (err) {
            if (!isAbortError(err)) console.error(err);
            showToast('Employee removed locally.', 'amber');
        }
    }
    
    state.nikList = state.nikList.filter(e => e.employeeId !== empId);
    renderNikManagementTable();
}

// ----------------------------------------------------
// DEPARTMENT MANAGEMENT UI (SUPER ADMIN)
// ----------------------------------------------------
function moduleLabel(key) {
    const m = BUDGET_MODULES.find(x => x.key === key);
    return m ? m.label : key;
}

async function renderDepartmentsTable() {
    const tbody = document.getElementById('dept-management-body');
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-secondary);">Loading divisions...</td></tr>`;
    
    await fetchDepartmentsList();
    
    if (state.departments.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-secondary);">No divisions yet. Add one to start scoping module & project access.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = state.departments.map(dept => {
        const validKeys = BUDGET_MODULES.map(m => m.key);
        const modules = parseCsvList(dept.allowedModules).filter(m => validKeys.includes(m));
        const projects = parseCsvList(dept.allowedProjects);
        const companies = parseCsvList(dept.allowedCompanies);
        const moduleHtml = modules.length === 0 || dept.allowedModules === 'ALL'
            ? '<span class="badge badge-emerald">ALL</span>'
            : modules.map(m => `<span class="badge badge-purple" style="margin:2px;">${moduleLabel(m)}</span>`).join('');
        const projectHtml = dept.allowedProjects === 'ALL'
            ? '<span class="badge badge-emerald">ALL</span>'
            : projects.map(p => `<span class="badge badge-indigo" style="margin:2px;">${p}</span>`).join('');
        const companyHtml = dept.allowedCompanies === 'ALL'
            ? '<span class="badge badge-emerald">ALL</span>'
            : companies.map(c => `<span class="badge" style="margin:2px;">${c}</span>`).join('');
        return `
        <tr>
            <td><strong>${esc(dept.department)}</strong></td>
            <td style="max-width:320px;">${moduleHtml}</td>
            <td style="max-width:260px;">${projectHtml}</td>
            <td style="max-width:260px;">${companyHtml}</td>
            <td>${dept.createdAt ? String(dept.createdAt).substring(0, 10) : '-'}</td>
            <td class="action-cell">
                <button class="btn-icon-sm" onclick="showDeptEditModal('${encodeURIComponent(dept.department)}')" title="Edit Division"><i data-lucide="pencil"></i></button>
                <button class="btn-delete" onclick="deleteDepartment('${encodeURIComponent(dept.department)}')" title="Delete Division"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>
    `}).join('');
    
    refreshIcons();
}

function showDeptEditModal(encodedName) {
    const deptName = encodedName ? decodeURIComponent(encodedName) : null;
    const dept = deptName ? state.departments.find(d => d.department === deptName) : null;
    
    // Module checkboxes
    const modContainer = document.getElementById('dept-module-checkboxes');
    const allowedMods = dept ? parseCsvList(dept.allowedModules) : BUDGET_MODULES.map(m => m.key);
    modContainer.innerHTML = BUDGET_MODULES.map(m => `
        <label class="checkbox-label" style="display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer;">
            <input type="checkbox" name="dept-module" value="${m.key}" ${allowedMods.includes(m.key) ? 'checked' : ''}>
            <span>${m.label}</span>
        </label>
    `).join('');
    
    // Project checkboxes
    const projContainer = document.getElementById('dept-project-checkboxes');
    const allowedProjs = dept ? parseCsvList(dept.allowedProjects) : state.metadata.projects;
    projContainer.innerHTML = state.metadata.projects.map(p => `
        <label class="checkbox-label" style="display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer;">
            <input type="checkbox" name="dept-project" value="${p}" ${allowedProjs.includes(p) ? 'checked' : ''}>
            <span>${p}</span>
        </label>
    `).join('');
    
    document.getElementById('dept-edit-name').value = dept ? dept.department : '';
    document.getElementById('dept-edit-name').readOnly = !!dept;
    
    document.getElementById('dept-edit-modal').style.display = 'flex';
}

function hideDeptEditModal() {
    document.getElementById('dept-edit-modal').style.display = 'none';
}

async function saveDepartmentPermissions() {
    const deptName = document.getElementById('dept-edit-name').value.trim();
    if (!deptName) {
        showToast('Division name is required.', 'amber');
        return;
    }
    
    const modCheckboxes = document.querySelectorAll('input[name="dept-module"]:checked');
    const selectedMods = Array.from(modCheckboxes).map(cb => cb.value);
    const allowedModsStr = (selectedMods.length === BUDGET_MODULES.length || selectedMods.length === 0) ? 'ALL' : selectedMods.join(',');
    
    const projCheckboxes = document.querySelectorAll('input[name="dept-project"]:checked');
    const selectedProjs = Array.from(projCheckboxes).map(cb => cb.value);
    const allowedProjsStr = (selectedProjs.length === state.metadata.projects.length || selectedProjs.length === 0) ? 'ALL' : selectedProjs.join(',');
    
    // Auto-map companies for selected projects
    let allowedComps = [];
    selectedProjs.forEach(proj => {
        const comps = (state.metadata.projectCompanyMapping || {})[proj] || [];
        comps.forEach(c => { if (!allowedComps.includes(c)) allowedComps.push(c); });
    });
    const allowedCompsStr = (allowedComps.length === 0 || allowedProjsStr === 'ALL') ? 'ALL' : allowedComps.join(',');
    
    const payload = {
        action: 'saveDepartment',
        department: deptName,
        allowedModules: allowedModsStr,
        allowedProjects: allowedProjsStr,
        allowedCompanies: allowedCompsStr,
        callerNik: state.currentUser ? state.currentUser.employeeId : ''
    };
    
    showToast('Saving division access...', 'info');
    
    if (state.gasUrl) {
        try {
            await fetchWithTimeout(state.gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
            showToast('Division access saved to Google Sheets.', 'emerald');
        } catch (err) {
            if (!isAbortError(err)) console.error(err);
            showToast('Saved division locally.', 'amber');
        }
    } else {
        showToast('Saved division access rules.', 'emerald');
    }
    
    // Update local state
    const existingIdx = state.departments.findIndex(d => d.department === deptName);
    const newRecord = { department: deptName, allowedModules: allowedModsStr, allowedProjects: allowedProjsStr, allowedCompanies: allowedCompsStr };
    if (existingIdx >= 0) state.departments[existingIdx] = newRecord;
    else state.departments.push(newRecord);
    
    hideDeptEditModal();
    renderDepartmentsTable();
    // Refresh dept selector so admin can switch to the new dept
    if (isSuperAdmin()) populateDeptSelector();
}

async function deleteDepartment(encodedName) {
    const deptName = decodeURIComponent(encodedName);
    if (!confirm(`Delete division "${deptName}"? Its employees will become unassigned.`)) return;
    
    showToast('Deleting division...', 'info');
    if (state.gasUrl) {
        try {
            await fetchWithTimeout(state.gasUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'deleteDepartment', department: deptName, callerNik: state.currentUser ? state.currentUser.employeeId : '' }) });
        } catch (err) {
            if (!isAbortError(err)) console.error(err);
        }
    }
    
    state.departments = state.departments.filter(d => d.department !== deptName);
    if (state.selectedDepartment === deptName) state.selectedDepartment = '';
    showToast(`Division "${deptName}" deleted.`, 'emerald');
    renderDepartmentsTable();
    populateDeptSelector();
}
