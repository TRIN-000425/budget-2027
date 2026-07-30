const XLSX = require('xlsx');
const wb = XLSX.readFile('Template Budget 2027_ OSYT.xlsx');
console.log('Sheets:', wb.SheetNames.join(', '));

// Find Summary and Dev Land sheets
const summarySheet = wb.SheetNames.find(n => n.toLowerCase().includes('summary') || n.toLowerCase().includes('sum'));
const devSheet = wb.SheetNames.find(n => n.toLowerCase().includes('dev') || n.toLowerCase().includes('land'));

console.log('\n--- SUMMARY SHEET:', summarySheet, '---');
if (summarySheet) {
    const ws = wb.Sheets[summarySheet];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    rows.slice(0, 60).forEach((row, i) => {
        const label = row[0] || row[1] || '';
        if (label) console.log(`Row ${i+1}: [${row.slice(0, 8).join(' | ')}]`);
    });
}

console.log('\n--- DEV & LAND SHEET:', devSheet, '---');
if (devSheet) {
    const ws = wb.Sheets[devSheet];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    rows.slice(0, 50).forEach((row, i) => {
        const label = row[0] || row[1] || row[2] || '';
        if (label) console.log(`Row ${i+1}: [${row.slice(0, 10).join(' | ')}]`);
    });
}
