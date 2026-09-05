@echo off
setlocal

echo.
echo ╔══════════════════════════════════╗
echo ║      SABER VAR - DEMARRAGE       ║
echo ╚══════════════════════════════════╝
echo.

where node >nul 2>&1 || (
  echo ERREUR: Node.js non trouve.
  echo Installer via https://nodejs.org ^(version 18+^)
  pause & exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -e "process.stdout.write(process.versions.node)"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo ERREUR: Node.js %NODE_MAJOR% detecte, version 18+ requise.
  pause & exit /b 1
)

where ffmpeg >nul 2>&1 && (
  echo OK: ffmpeg detecte - export video actif
) || (
  echo AVERTISSEMENT: ffmpeg absent - export desactive
  echo   Pour activer: winget install Gyan.FFmpeg
)

rem "call" obligatoire : npm est un .cmd, sans call le script s arrete apres la premiere installation
if not exist "server\node_modules" (echo Installation serveur... & cd server & call npm install --silent & cd ..)
if not exist "client\node_modules" (echo Installation client...  & cd client & call npm install --silent & cd ..)
if not exist "client\dist"         (echo Build interface...      & cd client & call npm run build --silent & cd ..)

echo.
echo Demarrage...
start /b cmd /c "cd server && npm start"
timeout /t 2 /nobreak >nul
start https://localhost:3000/setup
