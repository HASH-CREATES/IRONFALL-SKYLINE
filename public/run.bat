@echo off
REM IRONFALL // SKYLINE exhibition launcher - serves the production build on localhost:8000
cd /d %~dp0
echo Starting IRONFALL // SKYLINE on http://localhost:8000 ...
echo (press Ctrl+C to stop)
python -m http.server 8000
pause
