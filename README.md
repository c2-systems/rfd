## Setup

* ```sudo apt update```
* Insert dongle
* ```ifconfig``` check there is a wlan1

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

Then, compile Kismet and the Kismet tools: (this step can take almost an hour ...)

```
make
```


Now you can install:

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
