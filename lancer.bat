@echo off
title realtime-comm-infra
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Infrastructure de communication temps reel
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Node.js n'est pas installe ou n'est pas dans le PATH.
    echo Telechargez-le ici : https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installation des dependances, patientez...
    call npm install
    if errorlevel 1 (
        echo [ERREUR] echec de npm install.
        pause
        exit /b 1
    )
)

echo.
echo Demarrage du serveur sur http://localhost:3000
echo (Laissez cette fenetre ouverte ; fermez-la pour arreter le serveur)
echo.

start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
call npm start

pause
