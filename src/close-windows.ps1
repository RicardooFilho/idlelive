# Fecha as janelas do Chrome que o painel abriu (handles separados por vírgula).
param([string]$Handles)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition (Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'win.cs'))

foreach ($h in $Handles.Split(',', [StringSplitOptions]::RemoveEmptyEntries)) {
  [Win]::CloseChromeWindow([long]$h)
}
