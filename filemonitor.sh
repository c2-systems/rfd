#!/bin/bash

while true; do
   for file in /home/toor/*.kismet; do
       if [ -f "$file" ]; then
           echo "$(date '+%H:%M:%S'):  $(basename "$file"): $(du -h "$file" | cut -f1)"
       fi
   done
   echo ""
   sleep 5
done
