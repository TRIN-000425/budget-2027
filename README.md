# FY 2027 Project Planned Budget Planner

A premium, responsive web application for entering, calculating, and consolidatng project planned budgets for the fiscal year 2027. 

* **Frontend**: Hosted on Firebase Hosting (Single Page Application with HTML5, CSS3, and JavaScript).
* **Backend**: Serverless API powered by Google Apps Script (GAS) writing to Google Sheets.

---

## Folder Structure

```
├── public/
│   ├── index.html       # The main interface, navigation, selectors, headers, and tabs
│   ├── styles.css       # CSS Design System (dark-mode, glassmorphism, glowing inputs, transitions)
│   ├── app.js           # Live calculations engine, dynamic tab rendering, API sync logic
│   ├── metadata.json    # Lists of companies, projects, destinations, classifications (from Excel)
│   └── templates.json   # Account charts (G&A, Tax, Finance, Others, Dev & Land cost items)
├── gas/
│   └── Code.js          # Google Apps Script Web App API script (saves/loads budget JSON)
├── firebase.json        # Firebase Hosting deployment configuration
├── .firebaserc          # Firebase project register configuration
└── README.md            # Setup and deployment guidelines (This file)
```

---

## Step 1: Set up the Google Sheet & GAS Backend

1. Create a new **Google Sheet** in your Google Drive.
2. Go to **Extensions** -> **Apps Script** in the menu.
3. Delete any default code in `Code.gs` and paste the contents of `gas/Code.js` from this project.
4. Click the **Save** (disk) icon.
5. Click **Deploy** (top-right button) -> **New deployment**.
6. Select type: **Web App** (click the gear icon next to "Select type").
7. Configure the deployment:
   * **Description**: `2027 Budget API`
   * **Execute as**: `Me (your-email@gmail.com)`
   * **Who has access**: `Anyone` *(This is required to allow the Firebase frontend to make API calls to the sheet)*
8. Click **Deploy**.
9. Authorize permissions:
   * Click **Authorize access**.
   * Select your Google Account.
   * Click **Advanced** (at the bottom of the prompt) -> **Go to Project Planned Budget (unsafe)**.
   * Review permissions and click **Allow**.
10. Copy the **Web App URL** generated (it will look like `https://script.google.com/macros/s/XXXXX/exec`).

---

## Step 2: Deploy the Frontend to Firebase

1. Open your terminal in the project directory (`C:\Users\ACER\Documents\CODE\BUDGET\2027`).
2. Log in to your Firebase account:
   ```bash
   npx firebase login
   ```
3. Associate your local directory with your Firebase project:
   ```bash
   npx firebase use --add
   ```
   *Select your project from the list, or create one in the [Firebase Console](https://console.firebase.google.com) first, then select it.*
4. Deploy the site:
   ```bash
   npx firebase deploy
   ```
5. Once deployment is complete, Firebase will output a **Hosting URL** (e.g. `https://your-project-id.web.app`). Open it in your web browser.

---

## Step 3: Link the Website to your Backend

1. On your deployed website, look at the top right header for the status indicator (e.g., click on the **Synced** / **Unsaved Draft** text status).
2. A configuration modal will pop up.
3. Paste the **Google Apps Script Web App URL** you copied in **Step 1** into the field.
4. Click **Save Link**.
5. Select a **Company** and **Project** from the dropdowns. The app will immediately load data from the Google Sheet (or initialize a clean draft if no data is found).

---

## Core Calculations & Ratios Implemented

The web app is modeled strictly after the spreadsheet formulas:
* **Target Marketing Revenue**: Units, SQM, and prices are entered. Sales Value is calculated as `Price/sqm * Monthly Sqm`.
* **Sales & Program Cost**: Inhouse and Agent commission components are entered monthly. Ratios are automatically computed against monthly target sales value: `Monthly Sales Cost / Monthly Target Sales`.
* **Marketing Activity**: Budgets for ATL and BTL campaigns are consolidated monthly. The app computes the ratio of Total Marketing Expenses to Target Sales.
* **Development & Land Cost**: Details for land acquisition, preparation, preliminaries, and constructions are entered. Realization percentage is computed as `(Realisasi s.d 31 July + Best Est Aug-Dec) / RAB_SPK`.
* **Employee & HC Program**: Payroll totals (Salary, Tax, BPJS) are summed. Human Capital training programs are added dynamically, and their total costs (`Qty * Price/unit`) are allocated to their planning months.
* **Capex (Fixed Assets)**: Equipment requests are added dynamically with quantity and unit price. Total capex value is summarized by purchase month.
* **Business Trip**: Trips are logged by Employee and Grade. Rates for flights, lodging, and daily allowances are dynamically pulled from company travel policy guidelines (Local vs. Overseas, Director vs. Manager vs. Staff).
* **Summary Budget**: Roll-ups of all individual tabs into a monthly consolidated forecast showing Target sales, Land/Dev costs, marketing, payroll, and capex.
