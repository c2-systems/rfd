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
		for (let key in probeRecord) {
			if (probeRecord[key] === 0) {
				delete probeRecord[key];
			} else if (typeof probeRecord[key] === 'object' && probeRecord[key] !== null && !Array.isArray(probeRecord[key])) {
				for (let nestedKey in probeRecord[key]) {
					if (probeRecord[key][nestedKey] === 0) {
						delete probeRecord[key][nestedKey];
					}
				}
			}
		}
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
    
    
    if (!fs.existsSync(dbPath)) {
      console.log('Database file not found:', dbPath);
      return false;
    }
    
    const db = new Database(dbPath, { readonly: true });
    
    try {
      // Focus on device table which should contain the probe information
      const deviceQuery = `SELECT * FROM devices LIMIT 1000`;
      const deviceRows = db.prepare(deviceQuery).all();
      
      
      const allProbes = [];
      
      for (const deviceRow of deviceRows) {
        const probeRecord = extractProbeInfo(deviceRow);
        if (probeRecord) {
          allProbes.push(probeRecord);
        }
      }
      
      console.log(`Extracted ${allProbes.length}/${deviceRows.length} records`);
      
      
      if (allProbes.length > 0) {
        const success = await uploadProbeData(allProbes);
        
        if (success) {
          return true;
        } else {
          console.log('Upload failed - do not flush database');
          return false;
        }
      } else {
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
    console.log('Process success');
	process.exit(0);
  }
}).catch((error) => {
  console.error('Kismet probe extractor failed:', error);
  process.exit(1);
});

