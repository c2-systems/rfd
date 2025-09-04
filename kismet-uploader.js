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
  const probes = [];
  
  try {
    // Process the device buffer to get JSON data
    const processedDevice = processBuffer(deviceData.device);
    
    if (!processedDevice) {
      return probes;
    }
    
    // Extract basic info
    const macaddr = processedDevice['kismet.device.base.macaddr'] || deviceData.devmac;
    const firstTime = processedDevice['kismet.device.base.first_time'] || deviceData.first_time;
    const lastTime = processedDevice['kismet.device.base.last_time'] || deviceData.last_time;
    
    // Look for probed SSIDs in the dot11 device data
    const dot11Device = processedDevice['dot11.device'];
    if (dot11Device) {
      // Check for probed SSIDs - they are in an array format
      if (dot11Device['dot11.device.probed_ssid_map'] && Array.isArray(dot11Device['dot11.device.probed_ssid_map'])) {
        const ssidArray = dot11Device['dot11.device.probed_ssid_map'];
        
        ssidArray.forEach(ssidRecord => {
          if (ssidRecord && ssidRecord['dot11.probedssid.ssid']) {
            probes.push({
              macaddr: macaddr,
              capture_time: ssidRecord['dot11.probedssid.first_time'] || firstTime,
              last_seen: ssidRecord['dot11.probedssid.last_time'] || lastTime,
              probed_ssid: ssidRecord['dot11.probedssid.ssid'],
              encryption: ssidRecord['dot11.probedssid.crypt_string'] || 'Unknown'
            });
          }
        });
      }
      
      // Also check the last probed SSID record as a fallback
      if (probes.length === 0 && dot11Device['dot11.device.last_probed_ssid_record']) {
        const lastRecord = dot11Device['dot11.device.last_probed_ssid_record'];
        if (lastRecord['dot11.probedssid.ssid']) {
          probes.push({
            macaddr: macaddr,
            capture_time: lastRecord['dot11.probedssid.first_time'] || firstTime,
            last_seen: lastRecord['dot11.probedssid.last_time'] || lastTime,
            probed_ssid: lastRecord['dot11.probedssid.ssid'],
            encryption: lastRecord['dot11.probedssid.crypt_string'] || 'Unknown'
          });
        }
      }
      
      // If device has probed SSIDs but we couldn't extract them
      if (probes.length === 0 && dot11Device['dot11.device.num_probed_ssids'] > 0) {
        probes.push({
          macaddr: macaddr,
          capture_time: firstTime,
          last_seen: lastTime,
          probed_ssid: 'HIDDEN_OR_UNKNOWN',
          encryption: 'Unknown'
        });
      }
    }
    
    // If no specific probe data found but this is a client device, still record it
    if (probes.length === 0 && deviceData.type === 'Wi-Fi Client') {
      probes.push({
        macaddr: macaddr,
        capture_time: firstTime,
        last_seen: lastTime,
        probed_ssid: null,
        encryption: null
      });
    }
    
  } catch (error) {
    console.error('Error extracting probe info for device:', deviceData.devmac, error);
  }
  
  return probes;
}

// Upload probe data
async function uploadProbeData(probeData) {
  try {
    const jsonData = JSON.stringify({
      dataType: 'wifi-probe-requests',
      timestamp: new Date().toISOString(),
      piSerial: serial,
      probes: probeData,
      summary: {
        totalProbes: probeData.length,
        uniqueDevices: new Set(probeData.map(p => p.macaddr)).size,
        uniqueSSIDs: new Set(probeData.map(p => p.probed_ssid).filter(s => s)).size
      }
    }, null, 2);
    
    const buffer = Buffer.from(jsonData, 'utf8');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `wifi-probes-${timestamp}.json`;
    
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
      console.log(`Uploaded probe data successfully as ${filename} (${probeData.length} devices, ${probeData.reduce((sum, d) => sum + d.probed_ssids.length, 0)} total probes)`);
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
    
    console.log(`Processing database: ${latestFile}`);
    
    if (!fs.existsSync(dbPath)) {
      console.log('Database file not found:', dbPath);
      return false;
    }
    
    const db = new Database(dbPath, { readonly: true });
    
    try {
      // Focus on device table which should contain the probe information
      const deviceQuery = `SELECT * FROM devices LIMIT 1000`;
      const deviceRows = db.prepare(deviceQuery).all();
      
      console.log(`Found ${deviceRows.length} device records`);
      
      const allProbes = [];
      
      for (const deviceRow of deviceRows) {
        const probes = extractProbeInfo(deviceRow);
        allProbes.push(...probes);
      }
      
      console.log(`Extracted ${allProbes.length} probe records`);
      
      // Log some sample data for debugging
      if (allProbes.length > 0) {
        console.log('Sample probe records:');
        allProbes.slice(0, 3).forEach((probe, idx) => {
          console.log(`${idx + 1}:`, {
            macaddr: probe.macaddr,
            probed_ssids_count: probe.probed_ssids ? probe.probed_ssids.length : 0,
            sample_ssids: probe.probed_ssids ? probe.probed_ssids.slice(0, 2).map(s => s.ssid) : []
          });
        });
      }
      
      // Only upload if we have actual probe data
      if (allProbes.length > 0) {
        const success = await uploadProbeData(allProbes);
        
        if (success) {
          console.log('Upload successful - database can be flushed');
          return true;
        } else {
          console.log('Upload failed - do not flush database');
          return false;
        }
      } else {
        console.log('No probe data found - skipping upload but database can be flushed');
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
console.log('Kismet WiFi probe extractor starting single run...');

processKismetDatabase().then((shouldFlush) => {
  if (shouldFlush) {
    console.log('Kismet probe extractor completed successfully - database should be flushed');
  } else {
    console.log('Kismet probe extractor completed - no flush needed');
  }
  process.exit(0);
}).catch((error) => {
  console.error('Kismet probe extractor failed:', error);
  process.exit(1);
});
