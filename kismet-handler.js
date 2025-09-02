const fs = require('fs');
const { spawn } = require('child_process');

const serial = getRPiSerial();

fetch('https://expressapp-igdj5fhnlq-ey.a.run.app/boot', {
  headers: { 'X-Pi-Serial': serial }
}).then(()=>{});

function startKismet() {
  const kismetProcess = spawn('kismet', [
    '--capture-source', 'wlan1',
    '--no-ncurses',
    '--daemonize',
    '--log-types', 'kismet',
    '--log-title', 'rpi-kismet',
    '--log-rotate-seconds', '3600',  // Rotate every hour (3600 seconds)
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

// Start Kismet
const kismet = startKismet();
