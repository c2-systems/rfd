#!/bin/bash

# Hard-coded file path - change this to your desired file
file_path="/home/toor/*.kismet"

while true; do
    echo "$(date '+%H:%M:%S'): $(du -h "$file_path" | cut -f1)"
    sleep 5
done
