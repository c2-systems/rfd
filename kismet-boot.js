const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

// Send boot notification
fetch('https://expressapp-igdj5fhnlq-ey.a.run.app/boot', {
  headers: {
    'X-Pi-Serial': serial
  }
}).then(() => {
  console.log('Boot notification sent');
}).catch(err => {
  console.error('Boot notification failed:', err);
});

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
    // Restart Kismet if it crashes
    console.log('Restarting Kismet...');
    setTimeout(startKismet, 5000);
  });

  return kismetProcess;
}

// Start Kismet
const kismet = startKismet();
console.log('Kismet started successfully');
