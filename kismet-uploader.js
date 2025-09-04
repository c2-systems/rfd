const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Get RPi Serial
function getRPiSerial() {
  try {
    const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    const serialMatch = cpuInfo.match(/Serial\s*:\s*([a-f0-9]+)/i);
    return serialMatch ? serialMatch[1] : null;
  } catch (error) {
    console.error('Error reading serial:', error);
    return null;
  }
}

const serial = getRPiSerial();

// Track last processed timestamp
let lastProcessedTimestamp = 0;
const stateFile = '/home/toor/.kismet-uploader-state.json';

// Tables to skip for WiFi probe analysis
const SKIP_TABLES = ['alerts', 'messages', 'snapshots', 'sqlite_sequence'];

// Load state
function loadState() {
  try {
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      lastProcessedTimestamp = state.lastProcessedTimestamp || 0;
      console.log(`Loaded state: last processed timestamp ${lastProcessedTimestamp}`);
    }
  } catch (error) {
    console.error('Error loading state:', error);
    lastProcessedTimestamp = 0;
  }
}

// Save state
function saveState() {
  try {
    fs.writeFileSync(stateFile, JSON.stringify({
      lastProcessedTimestamp: lastProcessedTimestamp,
      updatedAt: new Date().toISOString()
    }));
  } catch (error) {
    console.error('Error saving state:', error);
  }
}

// Process Buffer data (similar to extraction script)
function processBuffer(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  // Check if this is a Buffer object with numeric keys
  const keys = Object.keys(obj);
  const isNumericKeysBuffer = keys.length > 0 && 
      keys.every(key => /^\d+$/.test(key)) &&
      keys.length > 10 && 
      typeof obj[keys[0]] === 'number';
  
  if (isNumericKeysBuffer) {
      const dataArray = [];
      for (let i = 0; i < keys.length; i++) {
          if (obj[i.toString()] !== undefined) {
              dataArray.push(obj[i.toString()]);
          }
      }
      
      const asciiString = dataArray
          .map(byte => (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.')
          .join('');
      
      try {
          const parsedJson = JSON.parse(asciiString);
          return { type: "Buffer", data: parsedJson };
      } catch (jsonError) {
          const hexString = dataArray
              .map(byte => byte.toString(16).padStart(2, '0'))
              .join('');
          return { type: "Buffer", hex: hexString };
      }
  }
  
  // Check traditional Buffer object
  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
      const asciiString = obj.data
          .map(byte => (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.')
          .join('');
      
      try {
          const parsedJson = JSON.parse(asciiString);
          return { type: obj.type, data: parsedJson };
      } catch (jsonError) {
          const hexString = obj.data
              .map(byte => byte.toString(16).padStart(2, '0'))
              .join('');
          return { type: obj.type, hex: hexString };
      }
  }
  
  if (Array.isArray(obj)) {
      return obj.map(item => processBuffer(item));
  }
  
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
      result[key] = processBuffer(value);
  }
  return result;
}

// Upload combined WiFi probe data
async function uploadCombinedData(allTableData) {
  try {
    const jsonData = JSON.stringify({
      dataType: 'kismet-wifi-probes',
      timestamp: new Date().toISOString(),
      piSerial: serial,
      tables: allTableData,
      summary: {
        tableCount: Object.keys(allTableData).length,
        totalRecords: Object.values(allTableData).reduce((sum, records) => sum + records.length, 0),
        tableBreakdown: Object.fromEntries(
          Object.entries(allTableData).map(([name, records]) => [name, records.length])
        )
      }
    }, null, 2);
    
    const buffer = Buffer.from(jsonData, 'utf8');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `kismet-wifi-probes-${timestamp}.json`;
    
    console.log(`Attempting upload with Pi Serial: ${serial}, filename: ${filename}`);
    
    const response = await fetch('https://expressapp-igdj5fhnlq-ey.a.run.app/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': filename,
        'X-Pi-Serial': serial
      },
      body: buffer
    });
    
    if (response.ok) {
      const totalRecords = Object.values(allTableData).reduce((sum, records) => sum + records.length, 0);
      console.log(`Uploaded WiFi probe data successfully as ${filename} (${totalRecords} total records)`);
      return true;
    } else {
      const errorText = await response.text();
      console.error(`Upload failed for WiFi probe data:`, response.status, errorText);
      return false;
    }
  } catch (error) {
    console.error(`Error uploading WiFi probe data:`, error);
    return false;
  }
}

// Process kismet database for WiFi probes
async function processKismetDatabase() {
  const homeDir = '/home/toor';
  
  try {
    const files = fs.readdirSync(homeDir);
    const kismetFiles = files.filter(file => 
      file.startsWith('rpi-kismet') && 
      file.endsWith('.kismet')
    );
    
    if (kismetFiles.length === 0) {
      console.log('No kismet database files found');
      return;
    }
    
    const latestFile = kismetFiles.sort().pop();
    const dbPath = path.join(homeDir, latestFile);
    
    console.log(`Processing database: ${latestFile}, last processed timestamp: ${lastProcessedTimestamp}`);
    
    if (!fs.existsSync(dbPath)) {
      console.log('Database file not found:', dbPath);
      return;
    }
    
    const db = new Database(dbPath, { readonly: true });
    
    try {
      // Get all table names, excluding the ones we don't need for WiFi probes
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
        .filter(table => !SKIP_TABLES.includes(table.name))
        .filter(table => !table.name.startsWith('sqlite_'));
      
      console.log(`Processing ${tables.length} tables for WiFi probe data (skipping: ${SKIP_TABLES.join(', ')})`);
      
      const allTableData = {};
      let hasNewData = false;
      let maxTimestamp = lastProcessedTimestamp;
      
      for (const table of tables) {
        const tableName = table.name;
        
        try {
          // Check if table has timestamp-like columns
          const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
          const hasTimestamp = columns.some(col => 
            col.name.includes('time') || col.name.includes('ts_') || col.name.includes('last_')
          );
          
          let query;
          let params = [];
          
          if (hasTimestamp) {
            // Try common timestamp column names
            const timestampColumns = ['ts_sec', 'last_time', 'first_time', 'timestamp'];
            let timestampCol = null;
            
            for (const col of timestampColumns) {
              const columnExists = columns.some(c => c.name === col);
              if (columnExists) {
                timestampCol = col;
                break;
              }
            }
            
            if (timestampCol) {
              query = `SELECT * FROM "${tableName}" WHERE "${timestampCol}" > ? ORDER BY "${timestampCol}" ASC LIMIT 500`;
              params = [lastProcessedTimestamp];
            } else {
              query = `SELECT * FROM "${tableName}" LIMIT 100`;
            }
          } else {
            query = `SELECT * FROM "${tableName}" LIMIT 100`;
          }
          
          const rows = db.prepare(query).all(...params);
          
          if (rows.length === 0) {
            allTableData[tableName] = [];
            continue;
          }
          
          // Filter out Wi-Fi AP entries and process buffers
          const processedRows = rows
            .filter(row => row.type !== "Wi-Fi AP")
            .map(row => processBuffer(row));
          
          allTableData[tableName] = processedRows;
          
          if (processedRows.length > 0) {
            hasNewData = true;
            console.log(`Found ${processedRows.length} new ${tableName} records`);
            
            // Update max timestamp if this table has timestamps
            if (hasTimestamp) {
              const timestampColumns = ['ts_sec', 'last_time', 'first_time', 'timestamp'];
              for (const col of timestampColumns) {
                if (rows[0][col] && typeof rows[0][col] === 'number') {
                  const tableMaxTimestamp = Math.max(...rows.map(r => r[col] || 0));
                  if (tableMaxTimestamp > maxTimestamp) {
                    maxTimestamp = tableMaxTimestamp;
                  }
                  break;
                }
              }
            }
          }
          
        } catch (tableError) {
          console.error(`Error processing table ${tableName}:`, tableError.message);
          allTableData[tableName] = [];
        }
      }
      
      // Only upload if we have new data
      if (hasNewData) {
        const totalRecords = Object.values(allTableData).reduce((sum, records) => sum + records.length, 0);
        console.log(`Total new WiFi probe records across all tables: ${totalRecords}`);
        
        const success = await uploadCombinedData(allTableData);
        
        if (success) {
          lastProcessedTimestamp = maxTimestamp;
          saveState();
          console.log(`Updated last processed timestamp to: ${lastProcessedTimestamp}`);
        }
      } else {
        console.log('No new WiFi probe data found in any table');
      }
      
    } finally {
      db.close();
    }
    
  } catch (error) {
    console.error('Error processing kismet database:', error);
  }
}

// Load initial state
loadState();

// Process database every 5 minutes
setInterval(processKismetDatabase, 5 * 60 * 1000);

// Also do an initial processing after 1 minute
setTimeout(processKismetDatabase, 60 * 1000);

console.log('Kismet WiFi probe uploader service started - will process database every 5 minutes (excluding alerts, messages, snapshots)');
