sudo curl -o /home/toor/kismet.conf https://raw.githubusercontent.com/c2-systems/rfd/refs/heads/main/kismet.conf
sudo curl -o /etc/systemd/system/wlan1-monitor.service https://raw.githubusercontent.com/c2-systems/rfd/refs/heads/main/wlan1-monitor.service
sudo curl -o /etc/systemd/system/kismet-boot.service https://raw.githubusercontent.com/c2-systems/rfd/refs/heads/main/kismet-boot.service
sudo curl -o /etc/systemd/system/kismet-uploader.service https://raw.githubusercontent.com/c2-systems/rfd/refs/heads/main/kismet-uploader.service
sudo systemctl daemon-reload
sudo systemctl enable wlan1-monitor.service && sudo systemctl enable kismet-uploader.service
sudo systemctl restart wlan1-monitor.service && sudo systemctl restart kismet-uploader.service
