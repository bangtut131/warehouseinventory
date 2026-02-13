@echo off
echo Starting Inventory Intelligence with 4GB memory...
set NODE_OPTIONS=--max-old-space-size=4096
npm run dev
