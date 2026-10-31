# Abre uma janela de app do Chrome e move a janela nova para a posição pedida (em pixels físicos).
# O Chrome ignora --window-size/--window-position quando já está aberto, por isso movemos depois.
# Escreve o identificador (handle) da janela nova, para o painel conseguir fechá-la depois.
param(
  [string]$Chrome,
  [string]$ProfileDir,
  [string]$Url,
  [int]$X,
  [int]$Y,
  [int]$W,
  [int]$H
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition (Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'win.cs'))

[Win]::SetProcessDPIAware() | Out-Null
$before = [Win]::ChromeWindows()

Start-Process -FilePath $Chrome -ArgumentList "--profile-directory=`"$ProfileDir`"", "--app=$Url"

# Espera a janela nova aparecer (até ~10s) e move.
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 250
  $new = [Win]::ChromeWindows() | Where-Object { $before -notcontains $_ }
  if ($new) {
    Start-Sleep -Milliseconds 300
    foreach ($h in $new) {
      # SWP_NOZORDER | SWP_SHOWWINDOW
      [Win]::SetWindowPos([IntPtr]$h, [IntPtr]::Zero, $X, $Y, $W, $H, 0x0044) | Out-Null
      Write-Output $h
    }
    exit 0
  }
}
exit 1
