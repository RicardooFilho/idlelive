@echo off
title Painel de Lives
cd /d "%~dp0"
rem Sem o Node.js o painel nao abre: explica e abre a pagina de download.
where node >nul 2>nul
if errorlevel 1 (
  echo O IdleLive precisa do Node.js para funcionar.
  echo Vou abrir o site: baixe a versao LTS, instale clicando em "Avancar" e abra o iniciar.bat de novo.
  start "" https://nodejs.org
  pause
  exit /b 1
)
rem Ao ligar o PC (atalho "Iniciar com o Windows") o painel abre sem abrir o navegador.
if /i not "%~1"=="--windows" start "" http://localhost:3000
rem Avisa o servidor que ele roda por aqui, para o botao "Reiniciar servidor" aparecer.
set IDLELIVE_LAUNCHER=1
:inicio
node server.js
rem Codigo 75 = o botao "Reiniciar servidor" do painel (ou a atualizacao) pediu para abrir de novo.
if errorlevel 75 if not errorlevel 76 goto inicio
pause
