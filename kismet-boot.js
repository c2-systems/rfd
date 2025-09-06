const fs = require('fs');
const path = require('path');

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
async function sendBootNotification() {
  try {
    await fetch('https://expressapp-igdj5fhnlq-ey.a.run.app/boot', {
      headers: {
        'X-Pi-Serial': serial
      }
    });
    console.log('Boot notification sent');
  } catch (err) {
    console.error('Boot notification failed:', err);
  }
}

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

// Main execution
async function main() {
  console.log('Starting kismet boot setup...');
  
  // Send boot notification
  await sendBootNotification();
  
  // Clean up old files
  cleanupKismetFiles();
  
  console.log('Kismet boot setup completed. Uploader will handle kismet startup.');
  process.exit(0);
}

main().catch(error => {
  console.error('Kismet boot setup failed:', error);
  process.exit(1);
});
