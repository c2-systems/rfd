t-up	const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// State file to track last successful upload
const STATE_FILE = '/home/toor/last_upload_state.json';

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

// Identify old files that can be deleted
function identifyFilesToDelete(kismetFiles, currentFile) {
  const filesToDelete = [];
  
  // Sort files by creation time (filename contains timestamp)
  const sortedFiles = kismetFiles.sort();
  
  // Keep only the latest 2 files (current + 1 backup)
  // Delete all others except the current file being processed
  for (let i = 0; i < sortedFiles.length - 2; i++) {
    const fileToCheck = sortedFiles[i];
    if (fileToCheck !== currentFile) {
      filesToDelete.push(fileToCheck);
    }
  }
  
  return filesToDelete;
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
    console.log(`Successfully deleted ${deletedCount} old database files`);
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
		
		return probeRecord;
    } else {
		return null;
	}
    
    return probeRecord;
    
  } catch (error) {
    console.error('Error extracting probe info for device:', deviceData.devmac, error);
    return null;
  }
}

function deduplicateProbedSSIDs(probe) {
  // If the probe doesn't have a probed_ssid_map, return it unchanged
  if (!probe["dot11.device.probed_ssid_map"]) {
    return probe;
  }
  
  // Group by SSID and keep the one with latest last_time
  const ssidGroups = probe["dot11.device.probed_ssid_map"].reduce((acc, ssidEntry) => {
    const ssid = ssidEntry["dot11.probedssid.ssid"];
    const lastTime = ssidEntry["dot11.probedssid.last_time"];
    
    // If we haven't seen this SSID before, or if this entry is newer, keep it
    if (!acc[ssid] || lastTime > acc[ssid]["dot11.probedssid.last_time"]) {
      acc[ssid] = ssidEntry;
    }
    
    return acc;
  }, {});
  
  // Convert back to array
  const deduplicatedArray = Object.values(ssidGroups);
  
  // Update the probe object with deduplicated array
  return {
    ...probe,
    "dot11.device.probed_ssid_map": deduplicatedArray,
    // Also update the num_probed_ssids to reflect the new count
    "dot11.device.num_probed_ssids": deduplicatedArray.length
  };
}

function removeZeroValues(obj) {
    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map(item => {
            if (typeof item === 'object' && item !== null) {
                return removeZeroValues(item);
            }
            return item;
        });
    }
    
    // Handle objects
    let trimmedObj = {};
    
    for (let key in obj) {
        if (obj[key] !== 0) {
            // Check if it's an array
            if (Array.isArray(obj[key])) {
                trimmedObj[key] = removeZeroValues(obj[key]);
            }
            // Check if it's a nested object (not null, not array)
            else if (typeof obj[key] === 'object' && obj[key] !== null) {
                // Apply removeZeroValues to the nested object
                trimmedObj[key] = removeZeroValues(obj[key]);
            } else {
                trimmedObj[key] = obj[key];
            }
        } 
    }
    
    return trimmedObj;
}

// Process kismet database for WiFi probe requests
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
    
    // Identify files that can be deleted (keep latest 2 files)
    const filesToDelete = identifyFilesToDelete(kismetFiles, latestFile);
    
    if (!fs.existsSync(dbPath)) {
      console.log('Database file not found:', dbPath);
      return false;
    }
    
    const db = new Database(dbPath, { readonly: true });
    
    try {
      // Load the last upload time
      const lastUploadTime = loadLastUploadState();
      
      // Modified query to filter by last_time
      const deviceQuery = `
        SELECT * FROM devices 
        WHERE last_time > ? 
        ORDER BY last_time ASC 
        LIMIT 1000
      `;
      
      const deviceRows = db.prepare(deviceQuery).all(lastUploadTime);
      
      
      const allProbes = [];
      let maxLastTime = lastUploadTime;
      
      for (const deviceRow of deviceRows) {
        const probeRecord = extractProbeInfo(deviceRow);
        if (probeRecord) {
          allProbes.push(probeRecord);
          // Track the maximum last_time for state saving
          if (probeRecord.last && probeRecord.last > maxLastTime) {
            maxLastTime = probeRecord.last;
          }
        }
      }
      
      console.log(`Extracted ${allProbes.length}/${deviceRows.length} records`);
      
      if (allProbes.length > 0) {
        const success = await uploadProbeData(allProbes);
        
        if (success) {
          // Save the new last upload time only on successful upload
          saveLastUploadState(maxLastTime);
          return true;
        } else {
          console.log('Upload failed - do not flush database');
          return false;
        }
      } else {
        // Even if no valid probes extracted, update the timestamp to avoid reprocessing
        saveLastUploadState(maxLastTime);
        return true;
      }
      
    } finally {
      db.close();
      
      // Delete old files after successful processing and database closure
      if (filesToDelete.length > 0) {
        console.log(`Found ${filesToDelete.length} old files to delete:`, filesToDelete);
        deleteOldFiles(filesToDelete);
      }
    }
    
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
