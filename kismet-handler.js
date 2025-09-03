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
      // Don't delete the file - it's the rolling log!
    } else {
      console.error(`Upload failed for ${fileName}:`, response.status);
    }
  } catch (error) {
    console.error(`Error uploading ${fileName}:`, error);
  }
}

// Copy and upload the rolling log file every 15 minutes
function uploadRollingLog() {
  const homeDir = '/home/toor';
  const rollingLogFile = 'rpi-kismet.kismet'; // This will be the consistent filename
  const rollingLogPath = path.join(homeDir, rollingLogFile);
  
  // Check if the rolling log exists
  if (fs.existsSync(rollingLogPath)) {
    // Create timestamped filename for upload
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); // YYYY-MM-DDTHH-MM-SS
    const uploadFileName = `${serial}/rpi-kismet-${timestamp}.kismet`;
    
    console.log(`Uploading rolling log as: ${uploadFileName}`);
    uploadToServer(rollingLogPath, uploadFileName);
  } else {
    console.log('Rolling log file not found yet');
  }
}

// Start periodic uploads every 15 minutes (900000 ms)
setInterval(uploadRollingLog, 15 * 60 * 1000);

// Also do an initial upload after 2 minutes to get started
setTimeout(uploadRollingLog, 2 * 60 * 1000);

function startKismet() {
  const kismetProcess = spawn('kismet', [
    '--capture-source', 'wlan1',
    '--no-ncurses',  
    '--config-file', '/home/toor/kismet.conf'
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

// Start Kismet
const kismet = startKismet();

console.log('Kismet started with rolling log uploads every 15 minutes');
