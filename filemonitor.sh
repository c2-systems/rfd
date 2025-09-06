#!/bin/bash

while true; do
   echo "$(date '+%H:%M:%S'):"
   for file in /home/toor/*.kismet; do
       if [ -f "$file" ]; then
           echo "  $(basename "$file"): $(du -h "$file" | cut -f1)"
       fi
   done
   echo ""
   sleep 5
done
