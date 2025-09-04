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

// Tables to skip for WiFi probe analysis
const SKIP_TABLES = ['alerts', 'messages', 'snapshots', 'sqlite_sequence', 'KISMET'];

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
      return false;
    }
    
    const latestFile = kismetFiles.sort().pop();
    const dbPath = path.join(homeDir, latestFile);
    
    console.log(`Processing database: ${latestFile}`);
    
    if (!fs.existsSync(dbPath)) {
      console.log('Database file not found:', dbPath);
      return false;
    }
    
    const db = new Database(dbPath, { readonly: true });
    
    try {
      // Get all table names, excluding the ones we don't need for WiFi probes
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
        .filter(table => !SKIP_TABLES.includes(table.name))
        .filter(table => !table.name.startsWith('sqlite_'));
      
      console.log(`Processing ${tables.length} tables for WiFi probe data (skipping: ${SKIP_TABLES.join(', ')})`);
      
      const allTableData = {};
      let totalRecords = 0;
      
      for (const table of tables) {
        const tableName = table.name;
        
        try {
          // Get all records from each table (no timestamp filtering)
          const query = `SELECT * FROM "${tableName}" LIMIT 1000`;
          const rows = db.prepare(query).all();
          
          if (rows.length === 0) {
            allTableData[tableName] = [];
            continue;
          }
          
          // Process buffers
          const processedRows = rows
            .map(row => processBuffer(row))
            .filter(row => row !== null);
          
          allTableData[tableName] = processedRows;
          totalRecords += processedRows.length;
          
          if (processedRows.length > 0) {
            console.log(`Found ${processedRows.length} ${tableName} records`);
          }
          
        } catch (tableError) {
          console.error(`Error processing table ${tableName}:`, tableError.message);
          allTableData[tableName] = [];
        }
      }
      
      console.log(`Total WiFi probe records across all tables: ${totalRecords}`);
      
      // Only upload if we have actual data
      if (totalRecords > 0) {
        const success = await uploadCombinedData(allTableData);
        
        if (success) {
          console.log('Upload successful - database can be flushed');
          return true;
        } else {
          console.log('Upload failed - do not flush database');
          return false;
        }
      } else {
        console.log('No data found - skipping upload but database can be flushed');
        return true;
      }
      
    } finally {
      db.close();
    }
    
  } catch (error) {
    console.error('Error processing kismet database:', error);
    return false;
  }
}

// Main execution - run once and exit
console.log('Kismet WiFi probe uploader starting single run...');

processKismetDatabase().then((shouldFlush) => {
  if (shouldFlush) {
    console.log('Kismet uploader completed successfully - database should be flushed');
  } else {
    console.log('Kismet uploader completed - no flush needed');
  }
  process.exit(0);
}).catch((error) => {
  console.error('Kismet uploader failed:', error);
  process.exit(1);
});
