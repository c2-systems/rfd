const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// State file to track last successful upload
const STATE_FILE = '/home/toor/last_upload_state.json';

// Rate limiting: delay between processing old files (in milliseconds)
const BACKLOG_PROCESSING_DELAY = 2000; // 2 seconds between each old file
const BACKLOG_BATCH_SIZE = 1000; // Records per batch

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

// Load last upload state
function loadLastUploadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const stateData = fs.readFileSync(STATE_FILE, 'utf8');
      const state = JSON.parse(stateData);
      return state.lastUploadTime || 0;
    }
  } catch (error) {
    console.error('Error loading state:', error);
  }
  return 0; // Default to 0 (epoch) if no state file or error
}

// Save last upload state
function saveLastUploadState(lastTime) {
  try {
    const state = {
      lastUploadTime: lastTime,
      timestamp: new Date().toISOString()
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('Error saving state:', error);
  }
}

// Helper function to sleep/delay
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Delete old database files
function deleteOldFiles(filenames) {
  const homeDir = '/home/toor';
  let deletedCount = 0;
  
  for (const filename of filenames) {
    try {
      const filePath = path.join(homeDir, filename);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Deleted: ${filename}`);
        deletedCount++;
      }
    } catch (error) {
      console.error(`Error deleting file ${filename}:`, error);
    }
  }
  
  if (deletedCount > 0) {
    console.log('');
    console.log(`Successfully deleted ${deletedCount} old database files`);
    console.log('');
  }
}

// Process Buffer data to extract JSON content
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
          return parsedJson;
      } catch (jsonError) {
          return null;
      }
  }
  
  // Check traditional Buffer object
  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
      const asciiString = obj.data
          .map(byte => (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.')
          .join('');
      
      try {
          const parsedJson = JSON.parse(asciiString);
          return parsedJson;
      } catch (jsonError) {
          return null;
      }
  }
  
  return obj;
}

// Extract probe information from device data
function extractProbeInfo(deviceData) {
  try {
    const ignoreList = ['Ziggo4953734', 'famgommans'];
    
    // Process the device buffer to get JSON data
    const processedDevice = processBuffer(deviceData.device);
    
    if (!processedDevice || deviceData.type === 'Wi-Fi AP') {
      return null;
    }
    
    // Extract basic info
    const macaddr = processedDevice['kismet.device.base.macaddr'] || deviceData.devmac;
    const firstTime = processedDevice['kismet.device.base.first_time'] || deviceData.first_time;
    const lastTime = processedDevice['kismet.device.base.last_time'] || deviceData.last_time;
    
    const basicInfo = {mac: macaddr, first: firstTime, last: lastTime};
        
    const dot11Device = processedDevice['dot11.device'];
    
    if (dot11Device) {
      let probeRecord = {...basicInfo, ...dot11Device};
      
      probeRecord = removeZeroValues(probeRecord);
      probeRecord = deduplicateProbedSSIDs(probeRecord);
      probeRecord = deduplicateClientMap(probeRecord);
      
      return probeRecord;
    } else {
      return null;
    }
    
  } catch (error) {
    console.error('Error extracting probe info for device:', deviceData.devmac, error);
    return null;
  }
}

function deduplicateProbedSSIDs(probe) {
  if (!probe["dot11.device.probed_ssid_map"]) {
    return probe;
  }
  
  const ssidGroups = probe["dot11.device.probed_ssid_map"].reduce((acc, ssidEntry) => {
    const ssid = ssidEntry["dot11.probedssid.ssid"];
    const lastTime = ssidEntry["dot11.probedssid.last_time"];
    const firstTime = ssidEntry["dot11.probedssid.first_time"];
    
    if (!acc[ssid]) {
      acc[ssid] = { ...ssidEntry };
    } else {
      acc[ssid] = {
        ...acc[ssid],
        "dot11.probedssid.last_time": Math.max(lastTime, acc[ssid]["dot11.probedssid.last_time"]),
        "dot11.probedssid.first_time": Math.min(firstTime, acc[ssid]["dot11.probedssid.first_time"])
      };
    }
    
    return acc;
  }, {});
  
  const deduplicatedArray = Object.values(ssidGroups);
  
  return {
    ...probe,
    "dot11.device.probed_ssid_map": deduplicatedArray,
    "dot11.device.num_probed_ssids": deduplicatedArray.length
  };
}

function removeZeroValues(obj) {
    if (Array.isArray(obj)) {
        return obj.map(item => {
            if (typeof item === 'object' && item !== null) {
                return removeZeroValues(item);
            }
            return item;
        });
    }
    
    let trimmedObj = {};
    
    for (let key in obj) {
        if (obj[key] !== 0) {
            if (Array.isArray(obj[key])) {
                trimmedObj[key] = removeZeroValues(obj[key]);
            }
            else if (typeof obj[key] === 'object' && obj[key] !== null) {
                trimmedObj[key] = removeZeroValues(obj[key]);
            } else {
                trimmedObj[key] = obj[key];
            }
        } 
    }
    
    return trimmedObj;
}

function deduplicateClientMap(device) {
  if (!device["dot11.device.client_map"]) {
    return device;
  }
  
  const bssidGroups = {};
  
  Object.values(device["dot11.device.client_map"]).forEach(clientEntry => {
    const bssid = clientEntry["dot11.client.bssid"];
    const lastTime = clientEntry["dot11.client.last_time"];
    const firstTime = clientEntry["dot11.client.first_time"];
    
    if (!bssidGroups[bssid]) {
      bssidGroups[bssid] = { ...clientEntry };
    } else {
      bssidGroups[bssid] = {
        ...bssidGroups[bssid],
        "dot11.client.last_time": Math.max(lastTime, bssidGroups[bssid]["dot11.client.last_time"]),
        "dot11.client.first_time": Math.min(firstTime, bssidGroups[bssid]["dot11.client.first_time"])
      };
    }
  });
  
  const deduplicatedClientMap = {};
  Object.values(bssidGroups).forEach(clientEntry => {
    const bssid = clientEntry["dot11.client.bssid"];
    deduplicatedClientMap[bssid] = clientEntry;
  });
  
  return {
    ...device,
    "dot11.device.client_map": deduplicatedClientMap,
    "dot11.device.num_client_aps": Object.keys(deduplicatedClientMap).length
  };
}

// Process a single database file
async function processSingleDatabaseFile(dbPath, lastUploadTime) {
  const db = new Database(dbPath, { readonly: true });
  
  try {
    const deviceQuery = `
      SELECT * FROM devices 
      WHERE last_time > ? 
      ORDER BY last_time ASC 
      LIMIT ?
    `;
    
    const deviceRows = db.prepare(deviceQuery).all(lastUploadTime, BACKLOG_BATCH_SIZE);
    
    const allProbes = [];
    let maxLastTime = lastUploadTime;
    
    for (const deviceRow of deviceRows) {
      const probeRecord = extractProbeInfo(deviceRow);
      if (probeRecord) {
        allProbes.push(probeRecord);
        if (probeRecord.last && probeRecord.last > maxLastTime) {
          maxLastTime = probeRecord.last;
        }
      }
    }
    
    return { allProbes, maxLastTime };
  } finally {
    db.close();
  }
}

// Process kismet database files with backlog support
async function processKismetDatabase() {
  const homeDir = '/home/toor';
  
  try {
    const files = fs.readdirSync(homeDir);
    const kismetFiles = files.filter(file => 
      file.startsWith('Kismet-') && 
      file.endsWith('.kismet')
    ).sort(); // Sort chronologically (oldest first)
    
    if (kismetFiles.length === 0) {
      console.log('No kismet database files found');
      return false;
    }
    
    console.log(`Found ${kismetFiles.length} database file(s)`);
    
    // Load the last upload time
    let lastUploadTime = loadLastUploadState();
    let processedCount = 0;
    let totalRecords = 0;
    let filesProcessed = [];
    
    // Process files sequentially from oldest to newest
    for (let i = 0; i < kismetFiles.length; i++) {
      const filename = kismetFiles[i];
      const dbPath = path.join(homeDir, filename);
      const isLatestFile = (i === kismetFiles.length - 1);
      
      if (!fs.existsSync(dbPath)) {
        console.log(`Database file not found: ${filename}`);
        continue;
      }
      
      console.log(`Processing file ${i + 1}/${kismetFiles.length}: ${filename}`);
      
      const { allProbes, maxLastTime } = await processSingleDatabaseFile(dbPath, lastUploadTime);
      
      console.log(`Extracted ${allProbes.length} records from ${filename}`);
      
      if (allProbes.length > 0) {
        const success = await uploadProbeData(allProbes);
        
        if (success) {
          saveLastUploadState(maxLastTime);
          lastUploadTime = maxLastTime; // Update for next file
          totalRecords += allProbes.length;
          processedCount++;
          
          // Mark old files for deletion (not the latest file)
          if (!isLatestFile) {
            filesProcessed.push(filename);
          }
          
          // Rate limiting: delay before processing next file (if not the last one)
          if (i < kismetFiles.length - 1) {
            console.log(`Rate limiting: waiting ${BACKLOG_PROCESSING_DELAY}ms before next file...`);
            await sleep(BACKLOG_PROCESSING_DELAY);
          }
        } else {
          console.log(`Upload failed for ${filename} - stopping backlog processing`);
          break; // Stop processing if upload fails
        }
      } else {
        // No new records in this file, mark it for deletion if not latest
        if (!isLatestFile) {
          filesProcessed.push(filename);
        }
      }
    }
    
    // Summary
    console.log('');
    console.log(`=== Processing Summary ===`);
    console.log(`Files processed: ${processedCount}/${kismetFiles.length}`);
    console.log(`Total records uploaded: ${totalRecords}`);
    console.log('');
    
    // Delete old files that were successfully processed
    if (filesProcessed.length > 0) {
      console.log(`Deleting ${filesProcessed.length} processed file(s)`);
      deleteOldFiles(filesProcessed);
    }
    
    return processedCount > 0;
    
  } catch (error) {
    console.error('Error processing kismet database:', error);
    return false;
  }
}

async function uploadProbeData(probeData) {
  try {
    const jsonData = JSON.stringify({
      timestamp: new Date().toISOString(),
      piSerial: serial,
      probes: probeData
    }, null, 2);
    
    const buffer = Buffer.from(jsonData, 'utf8');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `wifi-probes-${timestamp}.json`;
    
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
      return true;
    } else {
      const errorText = await response.text();
      console.error(`Upload failed for probe data:`, response.status, errorText);
      return false;
    }
  } catch (error) {
    console.error(`Error uploading probe data:`, error);
    return false;
  }
}

processKismetDatabase().then((processSuccess) => {
  if (processSuccess) {
    process.exit(0);
  }
}).catch((error) => {
  console.error('Kismet probe extractor failed:', error);
  process.exit(1);
});
