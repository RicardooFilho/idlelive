@echo off
title Painel de Lives
cd /d "%~dp0"
rem Ao ligar o PC (atalho "Iniciar com o Windows") o painel abre sem abrir o navegador.
if /i not "%~1"=="--windows" start "" http://localhost:3000
rem Avisa o servidor que ele roda por aqui, para o botao "Reiniciar servidor" aparecer.
set IDLELIVE_LAUNCHER=1
:inicio
node server.js
rem Codigo 75 = o botao "Reiniciar servidor" do painel pediu para abrir de novo.
if errorlevel 75 if not errorlevel 76 goto inicio
pause
