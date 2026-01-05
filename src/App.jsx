import React, { useState, useMemo, useEffect } from 'react';
import { 
  Upload, 
  FileSpreadsheet, 
  Search, 
  Download, 
  AlertCircle, 
  Clock, 
  Users, 
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ArrowUpDown,
  Filter
} from 'lucide-react';

// --- Helper Functions ---

// Parse "HH:MM" string to decimal hours (e.g., "08:30" -> 8.5)
const parseTimeStringToDecimal = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return 0;
  return hours + (minutes / 60);
};

// Safe number parsing
const safeFloat = (val) => {
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
};

// Check if a value is "empty" according to business rules
const isNotEmpty = (val) => {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string' && val.trim() === '') return false;
  return true;
};

export default function App() {
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState([]);
  const [fileName, setFileName] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [showOnlyIssues, setShowOnlyIssues] = useState(false);
  const [isLibLoaded, setIsLibLoaded] = useState(false);
  
  // Sorting state: default sort by empId ascending
  const [sortConfig, setSortConfig] = useState({ key: 'empId', direction: 'asc' });

  // --- Load XLSX Library Dynamically ---
  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.async = true;
    script.onload = () => setIsLibLoaded(true);
    script.onerror = () => setError("Failed to load Excel processing library. Please refresh.");
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // --- Core Processing Logic ---

  const handleFileUpload = (e) => {
    if (!window.XLSX) {
      setError("Excel library not loaded yet. Please wait a moment.");
      return;
    }

    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setFileName(file.name);
    setError(null);
    setData([]);
    setSummary([]);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        const workbook = window.XLSX.read(bstr, { type: 'binary' });
        const wsName = workbook.SheetNames[0];
        const ws = workbook.Sheets[wsName];
        
        // Convert to array of arrays to find header manually
        const rawData = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        // 1. Auto-detect header row
        let headerRowIndex = -1;
        let headers = [];
        
        for (let i = 0; i < Math.min(rawData.length, 20); i++) {
          const row = rawData[i].map(cell => String(cell).trim());
          if (row.includes('Employee ID') && row.includes('Date')) {
            headerRowIndex = i;
            headers = row;
            break;
          }
        }

        if (headerRowIndex === -1) {
          throw new Error("Could not find a valid header row containing 'Employee ID' and 'Date'. Please check the file format.");
        }

        // 2. Map Column Indices
        const colMap = {
          empId: headers.indexOf('Employee ID'),
          name: headers.indexOf('First Name'),
          dept: headers.indexOf('Department'),
          date: headers.indexOf('Date'),
          clockIn: headers.indexOf('Clock In'),
          clockOut: headers.indexOf('Clock Out'),
          totalHours: headers.indexOf('Total Hours'),
          workedHours: headers.indexOf('Worked Hours'),
          regularH: headers.indexOf('Regular(H)'),
        };

        // Validate essential columns
        const missingCols = Object.entries(colMap)
          .filter(([key, idx]) => idx === -1 && ['empId', 'date'].includes(key)) // Only strictly fail on ID/Date
          .map(([key]) => key);

        if (missingCols.length > 0) {
          throw new Error(`Critical columns missing: ${missingCols.join(', ')}`);
        }

        // 3. Process Rows
        const processedData = [];
        const employeeMap = {};

        // Start reading from the row after the header
        for (let i = headerRowIndex + 1; i < rawData.length; i++) {
          const row = rawData[i];
          if (!row || row.length === 0) continue;

          // Extract values
          const empId = row[colMap.empId];
          const dateStr = row[colMap.date];

          // Skip empty rows (sometimes footer junk)
          if (!empId && !dateStr) continue;

          const rawRegularH = colMap.regularH !== -1 ? row[colMap.regularH] : null;
          const rawWorkedH = colMap.workedHours !== -1 ? row[colMap.workedHours] : null;
          const rawTotalH = colMap.totalHours !== -1 ? row[colMap.totalHours] : null;
          
          const clockIn = colMap.clockIn !== -1 ? row[colMap.clockIn] : '';
          const clockOut = colMap.clockOut !== -1 ? row[colMap.clockOut] : '';
          const name = colMap.name !== -1 ? row[colMap.name] : 'Unknown';
          const dept = colMap.dept !== -1 ? row[colMap.dept] : 'Unknown';

          // --- LOGIC RULES ---
          
          // 1. Presence Rule:
          // Present if Regular(H) exists and > 0 OR Worked Hours is not empty
          const regularHVal = safeFloat(rawRegularH);
          const hasRegularH = regularHVal > 0;
          const hasWorkedH = isNotEmpty(rawWorkedH);
          
          const isPresent = hasRegularH || hasWorkedH;

          // 2. Actual Hours Priority:
          // Use Regular(H) first; if missing parse Worked Hours; if missing parse Total Hours.
          let actualHours = 0;
          let source = 'None';

          if (hasRegularH) {
            actualHours = regularHVal;
            source = 'Regular(H)';
          } else if (hasWorkedH) {
            actualHours = parseTimeStringToDecimal(rawWorkedH);
            source = 'Worked Hours';
          } else if (isNotEmpty(rawTotalH)) {
            actualHours = parseTimeStringToDecimal(rawTotalH);
            source = 'Total Hours';
          }

          // Build Record
          const record = {
            id: `${empId}-${dateStr}`, // Unique key
            empId,
            name,
            dept,
            date: dateStr,
            clockIn,
            clockOut,
            rawRegularH,
            rawWorkedH,
            rawTotalH,
            actualHours,
            isPresent,
            source
          };

          processedData.push(record);

          // Aggregate for Summary
          if (!employeeMap[empId]) {
            employeeMap[empId] = {
              empId,
              name,
              dept,
              daysPresent: 0,
              totalActualHours: 0,
              records: []
            };
          }

          employeeMap[empId].records.push(record);
          if (isPresent) {
            employeeMap[empId].daysPresent += 1;
            employeeMap[empId].totalActualHours += actualHours;
          }
        }

        // Finalize Summary
        const summaryList = Object.values(employeeMap).map(emp => ({
          ...emp,
          equivalentDays: emp.totalActualHours / 8
        }));

        setData(processedData);
        setSummary(summaryList);
        setLoading(false);

      } catch (err) {
        console.error(err);
        setError(err.message || "Failed to parse file.");
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  // --- UI Helpers ---

  const toggleRow = (empId) => {
    const newSet = new Set(expandedRows);
    if (newSet.has(empId)) {
      newSet.delete(empId);
    } else {
      newSet.add(empId);
    }
    setExpandedRows(newSet);
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const filteredSummary = useMemo(() => {
    // 1. Filter
    let result = summary.filter(emp => {
      const search = searchTerm.toLowerCase();
      return (
        String(emp.empId).toLowerCase().includes(search) ||
        String(emp.name).toLowerCase().includes(search) ||
        String(emp.dept).toLowerCase().includes(search)
      );
    });

    if (showOnlyIssues) {
      result = result.filter(emp => emp.daysPresent > 0 && emp.totalActualHours === 0);
    }

    // 2. Sort
    if (sortConfig.key) {
      result.sort((a, b) => {
        const valA = a[sortConfig.key];
        const valB = b[sortConfig.key];
        
        // Handle numeric sorting for pure numbers
        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
        }
        
        // Handle numeric-like strings (IDs) and standard strings
        // "numeric: true" option makes "2" come before "10"
        const strA = String(valA).toLowerCase();
        const strB = String(valB).toLowerCase();

        return sortConfig.direction === 'asc' 
          ? strA.localeCompare(strB, undefined, { numeric: true }) 
          : strB.localeCompare(strA, undefined, { numeric: true });
      });
    }

    return result;
  }, [summary, searchTerm, showOnlyIssues, sortConfig]);

  const SortHeader = ({ label, sortKey, align = 'left' }) => {
    const isActive = sortConfig.key === sortKey;
    return (
      <th 
        className={`px-6 py-3 cursor-pointer select-none hover:bg-slate-100 transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => handleSort(sortKey)}
      >
        <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
          {label}
          <div className="text-slate-400">
            {isActive ? (
              sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4 text-blue-600" /> : <ChevronDown className="w-4 h-4 text-blue-600" />
            ) : (
              <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />
            )}
          </div>
        </div>
      </th>
    );
  };

  const exportData = (format) => {
    if (summary.length === 0 || !window.XLSX) return;

    // 1. Create Summary Sheet
    // Note: We export the *filtered/sorted* summary view so what you see is what you get
    const summarySheetData = filteredSummary.map(emp => ({
      'Employee ID': emp.empId,
      'Name': emp.name,
      'Department': emp.dept,
      'Days Present': emp.daysPresent,
      'Total Actual Hours': emp.totalActualHours.toFixed(2),
      'Equivalent Days (8h)': emp.equivalentDays.toFixed(2)
    }));

    // 2. Create Details Sheet
    // Flatten records for filtered employees only? Or all? Usually export implies "all relevant data".
    // Let's stick to exporting ALL data for safety, or filtered data if desired. 
    // Standard practice is usually full dump unless explicit "Export Current View".
    // Let's export filtered view to be consistent with UI sorting.
    let detailsSheetData = [];
    filteredSummary.forEach(emp => {
      emp.records.forEach(rec => {
        detailsSheetData.push({
          'Employee ID': rec.empId,
          'Name': rec.name,
          'Date': rec.date,
          'Clock In': rec.clockIn,
          'Clock Out': rec.clockOut,
          'Regular(H) Raw': rec.rawRegularH,
          'Worked Hours Raw': rec.rawWorkedH,
          'Total Hours Raw': rec.rawTotalH,
          'Calculated Actual Hours': rec.actualHours.toFixed(2),
          'Calculation Source': rec.source,
          'Status': rec.isPresent ? 'Present' : 'Absent'
        });
      });
    });

    const wb = window.XLSX.utils.book_new();
    
    const wsSummary = window.XLSX.utils.json_to_sheet(summarySheetData);
    window.XLSX.utils.book_append_sheet(wb, wsSummary, "Attendance Summary");

    const wsDetails = window.XLSX.utils.json_to_sheet(detailsSheetData);
    window.XLSX.utils.book_append_sheet(wb, wsDetails, "Daily Details");

    const ext = format === 'csv' ? 'csv' : 'xlsx';
    if (format === 'csv') {
         window.XLSX.writeFile(wb, `Attendance_Analysis.${ext}`);
    } else {
         window.XLSX.writeFile(wb, `Attendance_Analysis.xlsx`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-blue-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500 rounded-lg">
                <FileSpreadsheet className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">ZKTeco Attendance Analyzer</h1>
                <p className="text-blue-100 text-sm">Compatible with iFace 990 Total Time Card Exports</p>
              </div>
            </div>
            
            {/* File Upload Area */}
            <div className="flex-shrink-0">
               <label className={`flex items-center gap-2 cursor-pointer bg-white text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg font-medium transition-colors shadow-sm ${!isLibLoaded ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <Upload className="w-4 h-4" />
                  <span>{fileName ? 'Change File' : 'Import Export File'}</span>
                  <input 
                    type="file" 
                    accept=".xlsx,.xls,.csv" 
                    className="hidden" 
                    onChange={handleFileUpload}
                    disabled={!isLibLoaded}
                  />
               </label>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        
        {/* Error State */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Loading Lib State */}
        {!isLibLoaded && !error && (
          <div className="mb-6 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg flex items-center gap-3">
             <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
             <p>Initializing Excel processing engine...</p>
          </div>
        )}

        {/* Empty State */}
        {!data.length && !loading && !error && isLibLoaded && (
          <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-slate-200">
             <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
               <Upload className="w-8 h-8" />
             </div>
             <h2 className="text-xl font-semibold text-slate-800">No Data Loaded</h2>
             <p className="text-slate-500 mt-2 max-w-md mx-auto">
               Upload a ZKTeco "Total Time Card" export file (XLSX or CSV) to begin analysis. 
               The app automatically detects headers and ignores title rows.
             </p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
           <div className="text-center py-20">
             <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
             <p className="text-slate-600">Processing attendance records...</p>
           </div>
        )}

        {/* Dashboard */}
        {data.length > 0 && !loading && (
          <div className="space-y-6">
            
            {/* Controls Bar */}
            <div className="flex flex-col md:flex-row gap-4 justify-between items-end md:items-center bg-white p-4 rounded-lg shadow-sm border border-slate-200">
               <div className="w-full md:w-auto flex flex-col sm:flex-row gap-4">
                 <div className="relative">
                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                   <input 
                      type="text" 
                      placeholder="Search employee..." 
                      className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none w-full sm:w-64"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                   />
                 </div>
               </div>

               <div className="flex items-center gap-2">
                 <button 
                    onClick={() => exportData('xlsx')}
                    className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                 >
                    <Download className="w-4 h-4" />
                    Export XLSX
                 </button>
               </div>
            </div>

            {/* Summary Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex items-center gap-4">
                 <div className="p-3 bg-blue-100 text-blue-600 rounded-full">
                   <Users className="w-6 h-6" />
                 </div>
                 <div>
                   <p className="text-sm text-slate-500 font-medium">Total Employees</p>
                   <p className="text-2xl font-bold text-slate-800">{summary.length}</p>
                 </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex items-center gap-4">
                 <div className="p-3 bg-green-100 text-green-600 rounded-full">
                   <Calendar className="w-6 h-6" />
                 </div>
                 <div>
                   <p className="text-sm text-slate-500 font-medium">Total Days Processed</p>
                   <p className="text-2xl font-bold text-slate-800">{data.length}</p>
                 </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex items-center gap-4">
                 <div className="p-3 bg-indigo-100 text-indigo-600 rounded-full">
                   <Clock className="w-6 h-6" />
                 </div>
                 <div>
                   <p className="text-sm text-slate-500 font-medium">Total Hours Logged</p>
                   <p className="text-2xl font-bold text-slate-800">
                     {summary.reduce((acc, curr) => acc + curr.totalActualHours, 0).toFixed(0)}
                   </p>
                 </div>
              </div>
            </div>

            {/* Main Table */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
               <div className="overflow-x-auto">
                 <table className="w-full text-left border-collapse">
                    <thead>
                       <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider group">
                          <th className="px-6 py-3 w-10"></th>
                          <SortHeader label="ID" sortKey="empId" />
                          <SortHeader label="Employee Name" sortKey="name" />
                          <SortHeader label="Department" sortKey="dept" />
                          <SortHeader label="Days Present" sortKey="daysPresent" align="right" />
                          <SortHeader label="Total Hours" sortKey="totalActualHours" align="right" />
                          <SortHeader label="Eqv. Days (8h)" sortKey="equivalentDays" align="right" />
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                       {filteredSummary.map((emp) => {
                         const isExpanded = expandedRows.has(emp.empId);
                         return (
                           <React.Fragment key={emp.empId}>
                             <tr className={`hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-blue-50/30' : ''}`}>
                                <td className="px-6 py-4 cursor-pointer" onClick={() => toggleRow(emp.empId)}>
                                  {isExpanded ? <ChevronDown className="w-4 h-4 text-blue-500" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                                </td>
                                <td className="px-6 py-4 text-sm font-medium text-slate-900">{emp.empId}</td>
                                <td className="px-6 py-4 text-sm text-slate-700 font-medium">{emp.name}</td>
                                <td className="px-6 py-4 text-sm text-slate-500">{emp.dept}</td>
                                <td className="px-6 py-4 text-sm text-slate-700 text-right">{emp.daysPresent}</td>
                                <td className="px-6 py-4 text-sm text-slate-700 text-right font-mono">{emp.totalActualHours.toFixed(2)}</td>
                                <td className="px-6 py-4 text-sm text-slate-700 text-right font-mono bg-slate-50">{emp.equivalentDays.toFixed(2)}</td>
                             </tr>
                             
                             {/* Expanded Details Row */}
                             {isExpanded && (
                               <tr>
                                 <td colSpan="7" className="px-0 py-0 bg-slate-50 border-b border-slate-200">
                                   <div className="p-4 sm:p-8">
                                     <div className="bg-white rounded border border-slate-200 overflow-hidden">
                                       <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                                          <h4 className="text-xs font-bold uppercase text-slate-500">Daily Breakdown: {emp.name}</h4>
                                          <span className="text-xs text-slate-400">Values derived from Regular(H) &gt; Worked Hours &gt; Total Hours</span>
                                       </div>
                                       <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                          <thead>
                                            <tr className="text-xs text-slate-400 border-b border-slate-100">
                                              <th className="px-4 py-2 text-left font-medium">Date</th>
                                              <th className="px-4 py-2 text-left font-medium">Clock In</th>
                                              <th className="px-4 py-2 text-left font-medium">Clock Out</th>
                                              <th className="px-4 py-2 text-left font-medium">Regular(H)</th>
                                              <th className="px-4 py-2 text-left font-medium">Worked Hrs</th>
                                              <th className="px-4 py-2 text-right font-medium">Calc. Hours</th>
                                              <th className="px-4 py-2 text-center font-medium">Status</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-50">
                                            {emp.records.map((rec) => (
                                              <tr key={rec.id} className={!rec.isPresent ? 'opacity-50 bg-slate-50' : ''}>
                                                <td className="px-4 py-2 font-mono text-slate-600">{rec.date}</td>
                                                <td className="px-4 py-2 text-slate-500">{rec.clockIn}</td>
                                                <td className="px-4 py-2 text-slate-500">{rec.clockOut}</td>
                                                <td className="px-4 py-2 text-slate-500">{rec.rawRegularH || '-'}</td>
                                                <td className="px-4 py-2 text-slate-500">{rec.rawWorkedH || '-'}</td>
                                                <td className="px-4 py-2 text-right font-bold text-slate-700 bg-blue-50/20">{rec.actualHours > 0 ? rec.actualHours.toFixed(2) : '-'}</td>
                                                <td className="px-4 py-2 text-center">
                                                  {rec.isPresent ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                                      Present
                                                    </span>
                                                  ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                                      Absent
                                                    </span>
                                                  )}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                       </div>
                                     </div>
                                   </div>
                                 </td>
                               </tr>
                             )}
                           </React.Fragment>
                         );
                       })}
                       
                       {filteredSummary.length === 0 && (
                         <tr>
                           <td colSpan="7" className="px-6 py-10 text-center text-slate-500">
                             No employees found matching your search.
                           </td>
                         </tr>
                       )}
                    </tbody>
                 </table>
               </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}