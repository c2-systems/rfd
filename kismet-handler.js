const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Your existing code
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

// Send boot notification with serial as header
fetch('https://expressapp-igdj5fhnlq-ey.a.run.app/boot', {
  headers: {
    'X-Pi-Serial': serial
  }
}).then(()=>{});

// Delete all existing kismet files after boot
function cleanupKismetFiles() {
  const homeDir = '/home/toor';
  try {
    const files = fs.readdirSync(homeDir);
    files.forEach(file => {
      if (file.includes('rpi-kismet') && (file.endsWith('.kismet') || file.endsWith('.kismet-journal'))) {
        const filePath = path.join(homeDir, file);
        fs.unlinkSync(filePath);
        console.log(`Deleted old kismet file: ${file}`);
      }
    });
  } catch (error) {
    console.error('Error cleaning up kismet files:', error);
  }
}

// Clean up old files
cleanupKismetFiles();

// Upload to your server
async function uploadToServer(filePath, fileName) {
  try {
    const fileData = fs.readFileSync(filePath);
    
    const response = await fetch('https://expressapp-igdj5fhnlq-ey.a.run.app/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': fileName,
        'X-Pi-Serial': serial
      },
      body: fileData
    });
    
    if (response.ok) {
      console.log(`Uploaded ${fileName} successfully`);
      fs.unlinkSync(filePath);
    } else {
      console.error(`Upload failed for ${fileName}:`, response.status);
    }
  } catch (error) {
    console.error(`Error uploading ${fileName}:`, error);
  }
}

// Monitor for closed Kismet files
function monitorKismetFiles() {
  const homeDir = '/home/toor';
  let knownFiles = new Set();
  
  // Get initial file list
  function updateKnownFiles() {
    try {
      const files = fs.readdirSync(homeDir);
      files.forEach(file => {
        if (file.includes('rpi-kismet') && file.endsWith('.kismet')) {
          knownFiles.add(file);
        }
      });
    } catch (error) {
      console.error('Error reading directory:', error);
    }
  }
  
  updateKnownFiles();
  
  // Check every 30 seconds for new files (since rotation is more frequent)
  setInterval(() => {
    try {
      const files = fs.readdirSync(homeDir);
      const currentKismetFiles = files.filter(file => 
        file.includes('rpi-kismet') && file.endsWith('.kismet')
      );
      
      currentKismetFiles.forEach(file => {
        if (!knownFiles.has(file)) {
          // New file detected, but wait to see if it's still being written to
          setTimeout(() => {
            const filePath = path.join(homeDir, file);
            const journalPath = filePath + '-journal';
            
            // Check if journal file exists (indicates file is still active)
            if (!fs.existsSync(journalPath)) {
              console.log(`Found closed Kismet file: ${file}`);
              const fileName = `${serial}/${file}`;
              uploadToServer(filePath, fileName);
            }
          }, 30000); // Wait 30 seconds to ensure file is closed
        }
      });
      
      // Update known files
      knownFiles = new Set(currentKismetFiles);
      
    } catch (error) {
      console.error('Error monitoring files:', error);
    }
  }, 30000); // Check every 30 seconds instead of 1 minute
}

function startKismet() {
  const kismetProcess = spawn('kismet', [
    '--capture-source', 'wlan1',
    '--no-ncurses',
    '--daemonize',
    '--log-types', 'kismet',
    '--log-title', 'rpi-kismet',
    '--log-rotate-seconds', '900',  // Rotate every 15 minutes (900 seconds)
    '--filter-tracker', 'TRACKERELEMENT(dot11.device/dot11.device.probed_ssid_map) and TRACKERELEMENT(dot11.device/dot11.device.probed_ssid_map) != ""'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  kismetProcess.stdout.on('data', (data) => {
    console.log(`Kismet: ${data}`);
  });

  kismetProcess.stderr.on('data', (data) => {
    console.error(`Kismet error: ${data}`);
  });

  kismetProcess.on('close', (code) => {
    console.log(`Kismet process exited with code ${code}`);
  });

  return kismetProcess;
}

// Start everything
const kismet = startKismet();
monitorKismetFiles();
