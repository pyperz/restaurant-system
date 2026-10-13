@echo off
rem Install cash drawer helper: copy file, start with Windows, run now
set "DEST=%LOCALAPPDATA%\RestaurantDrawer"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if not exist "%~dp0drawer-helper.ps1" (
  echo ERROR: drawer-helper.ps1 not found. Put it in the same folder as this file.
  pause
  exit /b 1
)
if not exist "%DEST%" mkdir "%DEST%"
copy /Y "%~dp0drawer-helper.ps1" "%DEST%\drawer-helper.ps1" >nul
> "%STARTUP%\restaurant-drawer.bat" (
  echo @echo off
  echo start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%DEST%\drawer-helper.ps1"
)
start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%DEST%\drawer-helper.ps1"
echo.
echo OK - Cash drawer helper installed and running.
echo It will start automatically every time Windows starts.
echo Go back to the POS: Settings - This device - Cash drawer - Test.
echo.
pause
