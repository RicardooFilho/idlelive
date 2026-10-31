@echo off
title Painel de Lives
cd /d "%~dp0"
rem Ao ligar o PC (atalho "Iniciar com o Windows") o painel abre sem abrir o navegador.
if /i not "%~1"=="--windows" start "" http://localhost:3000
node server.js
pause
