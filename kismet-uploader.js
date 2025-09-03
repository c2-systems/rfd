const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

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

// Upload data to server
async function uploadData(data, dataType) {
  try {
    const response = await fetch('https://expressapp-igdj5fhnlq-ey.a.run.app/upload-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pi-Serial': serial,
        'X-Data-Type': dataType
      },
      body: JSON.stringify(data)
    });
    
    if (response.ok) {
      console.log(`Uploaded ${data.length} ${dataType} records successfully`);
      return true;
    } else {
      console.error(`Upload failed for ${dataType}:`, response.status);
      return false;
    }
  } catch (error) {
    console.error(`Error uploading ${dataType}:`, error);
    return false;
  }
}

// Process kismet database
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
    
    // Process the most recent file
    const latestFile = kismetFiles.sort().pop();
    const dbPath = path.join(homeDir, latestFile);
    
    if (!fs.existsSync(dbPath)) {
      console.log('Database file not found:', dbPath);
      return;
    }
    
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    
    // Get new packets since last check
    const packetQuery = `
      SELECT * FROM packets 
      WHERE ts_sec > ? 
      ORDER BY ts_sec ASC 
      LIMIT 1000
    `;
    
    db.all(packetQuery, [lastProcessedTimestamp], async (err, packets) => {
      if (err) {
        console.error('Error querying packets:', err);
        return;
      }
      
      if (packets.length > 0) {
        console.log(`Found ${packets.length} new packets`);
        
        const success = await uploadData(packets, 'packets');
        if (success) {
          // Update last processed timestamp
          lastProcessedTimestamp = Math.max(...packets.map(p => p.ts_sec));
          saveState();
        }
      }
    });
    
    // Get new devices since last check
    const deviceQuery = `
      SELECT * FROM devices 
      WHERE last_time > ? 
      ORDER BY last_time ASC
    `;
    
    db.all(deviceQuery, [lastProcessedTimestamp], async (err, devices) => {
      if (err) {
        console.error('Error querying devices:', err);
        return;
      }
      
      if (devices.length > 0) {
        console.log(`Found ${devices.length} new/updated devices`);
        await uploadData(devices, 'devices');
      }
    });
    
    db.close();
    
  } catch (error) {
    console.error('Error processing kismet database:', error);
  }
}

// Load initial state
loadState();

// Process database every 30 seconds
setInterval(processKismetDatabase, 30 * 1000);

// Also do an initial processing after 1 minute
setTimeout(processKismetDatabase, 60 * 1000);

console.log('Kismet uploader service started - will process database every 30 seconds');
