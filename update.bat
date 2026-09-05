@echo off
setlocal

echo.
echo ╔══════════════════════════════════╗
echo ║     SABER VAR - MISE A JOUR      ║
echo ╚══════════════════════════════════╝
echo.

where git >nul 2>&1 || (
  echo ERREUR: Git non trouve. Installer via https://git-scm.com puis relancer.
  pause & exit /b 1
)
if not exist ".git" (
  echo ERREUR: ce dossier n'est pas un clone git.
  echo   Cloner le projet : git clone https://github.com/FrenchOreo/sabertour-var.git
  pause & exit /b 1
)

echo Recuperation de la derniere version...
git fetch origin main || (
  echo ERREUR: impossible de contacter GitHub ^(connexion internet ?^).
  pause & exit /b 1
)
git checkout main >nul 2>&1
git pull --ff-only origin main || (
  echo ERREUR: modifications locales en conflit.
  echo   Si rien n'est a conserver : git reset --hard origin/main  puis relancer update.bat
  pause & exit /b 1
)

echo Nettoyage de l'ancienne installation...
rem Sans cette etape, start.bat garde l'ancienne interface : il ne rebuild que si client\dist est absent
if exist "client\dist"          rmdir /s /q "client\dist"
if exist "client\node_modules"  rmdir /s /q "client\node_modules"
if exist "server\node_modules"  rmdir /s /q "server\node_modules"

echo Installation serveur...
pushd server
call npm install --silent || (popd & echo ERREUR: installation serveur echouee. & pause & exit /b 1)
popd

echo Installation + build interface...
pushd client
call npm install --silent || (popd & echo ERREUR: installation client echouee. & pause & exit /b 1)
call npm run build --silent || (popd & echo ERREUR: build de l'interface echoue. & pause & exit /b 1)
popd

if exist "node_modules" (
  echo Mise a jour des dependances Electron...
  call npm install --silent
)

echo.
echo OK: SABER VAR est a jour. Lancer start.bat
echo.
pause
