## Setup

* ```sudo apt update```
* Insert dongle
* ```ifconfig``` check there is a wlan1

```
sudo apt install nodejs npm
```

Install uplaoder dependency in /home/toor

```
npm i better-sqlite3
```

```
sudo apt install build-essential git libwebsockets-dev pkg-config \
zlib1g-dev libnl-3-dev libnl-genl-3-dev libcap-dev libpcap-dev \
libnm-dev libdw-dev libsqlite3-dev libprotobuf-dev libprotobuf-c-dev \
protobuf-compiler protobuf-c-compiler libsensors-dev libusb-1.0-0-dev \
python3 python3-setuptools python3-protobuf python3-requests \
python3-numpy python3-serial python3-usb python3-dev python3-websockets \
libubertooth-dev libbtbb-dev libmosquitto-dev librtlsdr-dev rtl-433
```

Clone kismet into a folder:

```
git clone https://www.kismetwireless.net/git/kismet.git
```

In the kismet folder just cloned, run: 

```
cd kismet
./configure
```

First make version:

```
make version
```

Create a swap file to not run out of RAM during make.

```
# Create a 4GB swap file
sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Verify it's active
free -h
```

```
# Now try building with one CPU core
make -j1
```

Then, compile Kismet and the Kismet tools: (this step can take almost an hour ...)




## ~~~ MOVE SD CARD TO ACTUAL RPI NOW - HEAVY LIFTING IS OVER ~~~

Run install:

```
cd kismet
```

```
sudo make suidinstall
```

Set up a group connected to your username:

```
sudo usermod -aG kismet your-user-here
```

See groups by running

```
groups
```

Download setup script

```
cd /home/toor
```

```
sudo wget https://raw.githubusercontent.com/c2-systems/rfd/refs/heads/main/reloadservicesandconf.sh
```
```
sudo chmod +x /home/toor/reloadservicesandconf.sh
```

```
./reloadservicesandconf.sh
```
\*fwvB?4*_u-(%gJJ

## Check working with Firebase

Look in Firestore boot collection for the new device checking in

In Raspberry connect open a terminal and follow uploads with

```
sudo journalctl -u kismet-uploader.service -f
```

## Associate device with a user

In Firestore add a document to the device collection with the serial number and associated user ID.
