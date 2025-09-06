#!/bin/bash

# Kismet setup script for Raspberry Pi
echo "Setting up Kismet WiFi probe collection system..."

# Download configuration files
echo "Downloading configuration files..."
sudo curl -o /home/toor/kismet.conf https://raw.githubusercontent.com/c2-systems/rfd/refs/heads/main/kismet.conf
sudo curl -o /etc/systemd/system/wlan1-monitor.service https://raw.githubusercontent.com/c2-systems/rfd/refs/heads/main/wlan1-monitor.service
sudo curl -o /etc/systemd/system/kismet-boot.service https://raw.githubusercontent.com/c2-systems/rfd/refs/heads/main/kismet-boot.service
sudo curl -o /etc/systemd/system/kismet-uploader.service https://raw.githubusercontent.com/c2-systems/rfd/refs/heads/main/kismet-uploader.service
sudo curl -o /home/toor/filemonitor.sh https://raw.githubusercontent.com/c2-systems/rfd/refs/heads/main/filemonitor.sh

# Set correct ownership for kismet.conf
sudo chown toor:toor /home/toor/kismet.conf

# Make filemonitor executable
sudo chmod +x /home/toor/filemonitor.sh

# Reload systemd configuration
echo "Reloading systemd configuration..."
sudo systemctl daemon-reload

# Stop services if they're running
echo "Stopping existing services..."
sudo systemctl stop kismet-uploader.service 2>/dev/null || true
sudo systemctl stop kismet-boot.service 2>/dev/null || true
sudo systemctl stop wlan1-monitor.service 2>/dev/null || true

# Enable services
echo "Enabling services..."
sudo systemctl enable wlan1-monitor.service
sudo systemctl enable kismet-boot.service
sudo systemctl enable kismet-uploader.service

# Start services in correct order
echo "Starting services..."
sudo systemctl start wlan1-monitor.service
sleep 2
sudo systemctl start kismet-boot.service
sleep 2
sudo systemctl start kismet-uploader.service

# Check status
echo "Checking service status..."
sudo systemctl status wlan1-monitor.service --no-pager -l
sudo systemctl status kismet-boot.service --no-pager -l
sudo systemctl status kismet-uploader.service --no-pager -l

# Update this script itself
echo "Updating setup script..."
sudo curl -o /home/toor/reloadservicesandconf.sh https://raw.githubusercontent.com/c2-systems/rfd/refs/heads/main/reloadservicesandconf.sh
sudo chmod +x /home/toor/reloadservicesandconf.sh

echo "Setup complete!"
echo "Starting log monitor for kismet-uploader service..."
journalctl -f -u kismet-uploader.service
