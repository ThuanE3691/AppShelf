# AppShelf local control script (personal demo project).
# Usage: pwsh scripts/appshelf.ps1 <init|up|down|ps|logs|dc> [args]
#   init  create .secrets.local with random values when missing (never prints them)
#   up    start the whole stack in the background
#   down  stop and remove containers; volumes (data) are kept
#   ps    list services;  logs [service]  follow logs;  dc <args>  raw docker compose
param(
  [Parameter(Position = 0)]
  [ValidateSet('init', 'up', 'down', 'ps', 'logs', 'dc')]
  [string]$Command = 'up',
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$Rest = @()
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$SecretsFile = Join-Path $Root '.secrets.local'
$UserSecretsFile = Join-Path $Root '.env.local'

function New-RandomSecret([int]$Bytes = 24) {
  $buffer = [byte[]]::new($Bytes)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return ([System.BitConverter]::ToString($buffer) -replace '-', '').ToLowerInvariant()
}

function Initialize-Secrets {
  $names = 'POSTGRES_PASSWORD', 'MARIADB_PASSWORD', 'MARIADB_ROOT_PASSWORD', 'SESSION_SECRET', 'WP_NETWORK_ADMIN_PASSWORD'
  $existing = @{}
  if (Test-Path $SecretsFile) {
    foreach ($line in Get-Content $SecretsFile) {
      if ($line -match '^\s*([A-Z0-9_]+)=') { $existing[$Matches[1]] = $true }
    }
  }
  $added = @()
  foreach ($name in $names) {
    if (-not $existing.ContainsKey($name)) {
      Add-Content -Path $SecretsFile -Value "$name=$(New-RandomSecret)"
      $added += $name
    }
  }
  if ($added.Count -gt 0) { Write-Host "Generated: $($added -join ', ')" } else { Write-Host 'Secrets already present.' }
  if (-not (Test-Path $UserSecretsFile)) { throw 'Missing .env.local (Stripe test keys, Cloudflare token).' }
}

function Get-ComposeArgs {
  $files = @('compose.yaml', 'wordpress/compose.yaml', 'apps/web/compose.yaml', 'apps/worker/compose.yaml')
  $args = @()
  foreach ($f in $files) { if (Test-Path (Join-Path $Root $f)) { $args += @('-f', $f) } }
  $tunnel = 'infra/tunnel.compose.yaml'
  if ((Test-Path (Join-Path $Root $tunnel)) -and (Select-String -Path $UserSecretsFile -Pattern '^\s*TUNNEL_TOKEN=\S' -Quiet)) {
    $args += @('-f', $tunnel)
  }
  return $args
}

function Invoke-Compose([string[]]$ComposeArgs) {
  $all = @('compose') + (Get-ComposeArgs) + $ComposeArgs
  & docker @all
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed with exit code $LASTEXITCODE" }
}

switch ($Command) {
  'init' { Initialize-Secrets }
  'up' { Initialize-Secrets; Invoke-Compose (@('up', '-d', '--build') + $Rest) }
  'down' { Invoke-Compose (@('down') + $Rest) }
  'ps' { Invoke-Compose @('ps') }
  'logs' { Invoke-Compose (@('logs', '-f', '--tail', '200') + $Rest) }
  'dc' { Invoke-Compose $Rest }
}
