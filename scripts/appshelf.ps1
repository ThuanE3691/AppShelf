#Requires -Version 7.0
<#
.SYNOPSIS
  AppShelf control script (personal demo project, Stripe test mode only).

.DESCRIPTION
  pwsh scripts/appshelf.ps1 <command> [args]

    init        Create .secrets.local with random values when missing (never prints them).
    up          Pull the GHCR images and start the stack in the background (no local build).
    up --build  Build the images locally instead of pulling them, then start.
    down        Stop and remove containers. Volumes (data) are kept.
    ps          List services.
    logs [svc]  Follow logs.
    dc <args>   Run raw docker compose with the same files.
    tunnel      Create or reuse the Cloudflare tunnel "appshelf". Once CF_ZONE (in .env.local)
                names a domain: route app.<zone> and wp.<zone> through it, create the DNS
                records and the Stripe test webhook, and store the results in .secrets.local.
    set-domain  Move the WordPress network to WP_DOMAIN (after `tunnel`), backing up the
                database to backups/ first.

  Secrets are read from .env.local (yours) and .secrets.local (generated) in the repository
  root, or in APPSHELF_SECRETS_DIR when set (for git worktrees). Values are never printed.
  APPSHELF_PROJECT overrides the Compose project name (default "appshelf"), for isolated tests.
#>
# Console messages go to the host on purpose: several functions return values, so
# Write-Output would mix messages into their results.
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '', Justification = 'Interactive CLI output')]
# A plain (not advanced) script on purpose: everything after the command lands in $args
# untouched, so `down -v` reaches docker compose instead of binding to -Verbose.
param(
  [ValidateSet('init', 'up', 'down', 'ps', 'logs', 'dc', 'tunnel', 'set-domain')]
  [string]$Command = 'up',
  # Same as passing --build to `up`.
  [switch]$Build
)

[string[]]$Rest = @($args)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$SecretsDir = if ($env:APPSHELF_SECRETS_DIR) { $env:APPSHELF_SECRETS_DIR } else { $Root }
$SecretsFile = Join-Path $SecretsDir '.secrets.local'
$UserSecretsFile = Join-Path $SecretsDir '.env.local'

$TunnelName = 'appshelf'
$LocalWpDomain = 'wp.appshelf.localhost'
# Keep in step with STRIPE_FORWARD_EVENTS in apps/web/compose.yaml.
$StripeEvents = @(
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
)
# Non-secret settings in .secrets.local that Compose needs for ${...} interpolation.
$ConfigKeys = 'APP_URL', 'WP_DOMAIN', 'WP_PUBLIC_URL', 'WP_SCHEME'

# --- dotenv files -------------------------------------------------------------

function Read-DotEnv([string]$Path) {
  $values = [ordered]@{}
  if (Test-Path $Path) {
    foreach ($line in Get-Content $Path) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
        $values[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
      }
    }
  }
  return $values
}

# Sets KEY=value in a dotenv file, replacing an existing line or appending one.
function Write-DotEnvValue([string]$Path, [string]$Key, [string]$Value) {
  $lines = [System.Collections.Generic.List[string]]::new()
  if (Test-Path $Path) { foreach ($l in Get-Content $Path) { $lines.Add($l) } }
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^\s*$([regex]::Escape($Key))\s*=") { $lines[$i] = "$Key=$Value"; $found = $true }
  }
  if (-not $found) { $lines.Add("$Key=$Value") }
  Set-Content -Path $Path -Value $lines
}

function Get-RandomSecret([int]$Bytes = 24) {
  $buffer = [byte[]]::new($Bytes)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return ([System.BitConverter]::ToString($buffer) -replace '-', '').ToLowerInvariant()
}

function Initialize-SecretFile {
  $names = 'POSTGRES_PASSWORD', 'MARIADB_PASSWORD', 'MARIADB_ROOT_PASSWORD', 'SESSION_SECRET', 'WP_NETWORK_ADMIN_PASSWORD'
  $existing = Read-DotEnv $SecretsFile
  $added = @()
  foreach ($name in $names) {
    if (-not $existing.Contains($name)) {
      Add-Content -Path $SecretsFile -Value "$name=$(Get-RandomSecret)"
      $added += $name
    }
  }
  if ($added.Count -gt 0) { Write-Host "Generated: $($added -join ', ')" } else { Write-Host 'Secrets already present.' }
  if (-not (Test-Path $UserSecretsFile)) { throw 'Missing .env.local (Stripe test keys, Cloudflare token).' }
}

# Exports the public URL settings so Compose interpolates them (defaults stay local).
function Import-ComposeConfig {
  $secrets = Read-DotEnv $SecretsFile
  foreach ($key in $ConfigKeys) {
    if ($secrets[$key]) { Set-Item -Path "Env:$key" -Value $secrets[$key] }
  }
}

# --- docker compose -------------------------------------------------------------

function Test-TunnelEnabled {
  return [bool](Read-DotEnv $SecretsFile)['TUNNEL_TOKEN']
}

function Get-ComposeArgList {
  $composeArgs = @()
  if ($env:APPSHELF_PROJECT) { $composeArgs += @('-p', $env:APPSHELF_PROJECT) }
  # Values for ${...} in the compose files; each service maps only the keys it needs.
  foreach ($f in @($SecretsFile, $UserSecretsFile)) { if (Test-Path $f) { $composeArgs += @('--env-file', $f) } }
  $files = @('compose.yaml', 'wordpress/compose.yaml', 'apps/web/compose.yaml', 'apps/worker/compose.yaml', 'infra/images.compose.yaml')
  foreach ($f in $files) { if (Test-Path (Join-Path $Root $f)) { $composeArgs += @('-f', $f) } }
  if (Test-TunnelEnabled) { $composeArgs += @('-f', 'infra/tunnel.compose.yaml') }
  return $composeArgs
}

function Invoke-Compose([string[]]$ComposeArgs) {
  $all = @('compose') + (Get-ComposeArgList) + $ComposeArgs
  & docker @all
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed with exit code $LASTEXITCODE" }
}

# Services to start: every merged service, minus worker until apps/worker exists
# (infra/images.compose.yaml names it either way) and minus stripe-cli once the
# public Stripe webhook replaces local forwarding.
function Get-ServiceList {
  $all = @('compose') + (Get-ComposeArgList) + @('config', '--services')
  $services = @(& docker @all)
  if ($LASTEXITCODE -ne 0) { throw 'docker compose config failed' }
  $skip = @()
  if (-not (Test-Path (Join-Path $Root 'apps/worker/compose.yaml'))) { $skip += 'worker' }
  if ((Test-TunnelEnabled) -and (Read-DotEnv $SecretsFile)['STRIPE_WEBHOOK_SECRET']) { $skip += 'stripe-cli' }
  return @($services | Where-Object { $_ -and $_ -notin $skip })
}

function Invoke-Up([bool]$BuildLocally, [string[]]$Extra) {
  Initialize-SecretFile
  Import-ComposeConfig
  $services = Get-ServiceList
  if ($BuildLocally) {
    Invoke-Compose (@('up', '-d', '--build') + $Extra + $services)
  } else {
    Invoke-Compose (@('pull') + $services)
    Invoke-Compose (@('up', '-d', '--no-build') + $Extra + $services)
  }
  if (Test-TunnelEnabled) {
    Write-Host "Public: $($env:APP_URL) and $($env:WP_PUBLIC_URL) (Cloudflare tunnel)."
  } else {
    Write-Host 'Local: http://app.appshelf.localhost and http://wp.appshelf.localhost'
  }
}

# --- Cloudflare and Stripe APIs ---------------------------------------------------

function Get-ApiErrorText($ErrorRecord) {
  if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) { return $ErrorRecord.ErrorDetails.Message }
  return $ErrorRecord.Exception.Message
}

function Invoke-Cloudflare([string]$Method, [string]$Path, $Body = $null) {
  $request = @{
    Method      = $Method
    Uri         = "https://api.cloudflare.com/client/v4$Path"
    Headers     = @{ Authorization = "Bearer $script:CfToken" }
    ContentType = 'application/json'
  }
  if ($null -ne $Body) { $request.Body = ($Body | ConvertTo-Json -Depth 10 -Compress) }
  try { $response = Invoke-RestMethod @request }
  catch { throw "Cloudflare $Method $($Path -replace '\?.*$', '') failed: $(Get-ApiErrorText $_)" }
  if (-not $response.success) { throw "Cloudflare $Method $Path failed: $($response.errors | ConvertTo-Json -Compress)" }
  return $response.result
}

function Invoke-Stripe([string]$Method, [string]$Path, [hashtable]$Form = $null) {
  $request = @{
    Method  = $Method
    Uri     = "https://api.stripe.com/v1$Path"
    Headers = @{ Authorization = "Bearer $script:StripeKey" }
  }
  if ($Form) { $request.Body = $Form; $request.ContentType = 'application/x-www-form-urlencoded' }
  try { return Invoke-RestMethod @request }
  catch { throw "Stripe $Method $Path failed: $(Get-ApiErrorText $_)" }
}

function Get-CloudflareAccountId([string]$Configured) {
  if ($Configured) { return $Configured }
  $accounts = @(Invoke-Cloudflare -Method GET -Path '/accounts')
  if ($accounts.Count -ne 1) { throw 'Set CLOUDFLARE_ACCOUNT_ID in .env.local (the token sees zero or several accounts).' }
  return $accounts[0].id
}

# Returns the id of the remotely-managed tunnel named "appshelf", creating it when missing.
function Get-OrCreateTunnel([string]$AccountId) {
  $existing = @(Invoke-Cloudflare -Method GET -Path "/accounts/$AccountId/cfd_tunnel?name=$TunnelName&is_deleted=false")
  if ($existing.Count -gt 0) {
    Write-Host "Tunnel '$TunnelName' exists: $($existing[0].id)"
    return $existing[0].id
  }
  # config_src=cloudflare: ingress lives at Cloudflare, cloudflared needs only the token.
  $created = Invoke-Cloudflare -Method POST -Path "/accounts/$AccountId/cfd_tunnel" -Body @{ name = $TunnelName; config_src = 'cloudflare' }
  Write-Host "Tunnel '$TunnelName' created: $($created.id)"
  return $created.id
}

function Sync-TunnelDnsRecord([string]$ZoneId, [string]$Hostname, [string]$TunnelId) {
  $target = "$TunnelId.cfargotunnel.com"
  $record = @{ type = 'CNAME'; name = $Hostname; content = $target; proxied = $true; ttl = 1; comment = 'AppShelf demo tunnel' }
  $existing = @(Invoke-Cloudflare -Method GET -Path "/zones/$ZoneId/dns_records?name=$([uri]::EscapeDataString($Hostname))")
  if ($existing.Count -eq 0) {
    Invoke-Cloudflare -Method POST -Path "/zones/$ZoneId/dns_records" -Body $record | Out-Null
    Write-Host "DNS: created CNAME $Hostname -> $target (proxied)"
  } elseif ($existing[0].type -ne 'CNAME') {
    throw "$Hostname already has a $($existing[0].type) record. Remove it in Cloudflare, then run tunnel again."
  } elseif ($existing[0].content -eq $target -and $existing[0].proxied) {
    Write-Host "DNS: $Hostname already points at the tunnel"
  } else {
    Invoke-Cloudflare -Method PUT -Path "/zones/$ZoneId/dns_records/$($existing[0].id)" -Body $record | Out-Null
    Write-Host "DNS: updated CNAME $Hostname -> $target (proxied)"
  }
}

# Creates or updates the Stripe test webhook for the public URL; returns a new signing
# secret, or $null when the stored one is still valid. Stripe reveals a secret only at creation.
function Sync-StripeWebhook([string]$Url, [bool]$HaveSecret) {
  $form = @{ url = $Url; description = 'AppShelf demo (Cloudflare tunnel)'; 'metadata[app]' = 'appshelf' }
  for ($i = 0; $i -lt $StripeEvents.Count; $i++) { $form["enabled_events[$i]"] = $StripeEvents[$i] }

  $endpoints = @((Invoke-Stripe -Method GET -Path '/webhook_endpoints?limit=100').data | Where-Object { $_.url -eq $Url })
  if ($endpoints.Count -gt 0 -and $HaveSecret) {
    $form.Remove('url')
    $form['disabled'] = 'false'
    Invoke-Stripe -Method POST -Path "/webhook_endpoints/$($endpoints[0].id)" -Form $form | Out-Null
    Write-Host "Stripe: webhook $($endpoints[0].id) updated for $Url"
    return $null
  }
  foreach ($endpoint in $endpoints) {
    # Its signing secret is not stored here and cannot be read back: replace it.
    Invoke-Stripe -Method DELETE -Path "/webhook_endpoints/$($endpoint.id)" | Out-Null
    Write-Host "Stripe: removed webhook $($endpoint.id) (signing secret unknown)"
  }
  $created = Invoke-Stripe -Method POST -Path '/webhook_endpoints' -Form $form
  Write-Host "Stripe: webhook $($created.id) created for $Url"
  return $created.secret
}

function Invoke-Tunnel {
  $user = Read-DotEnv $UserSecretsFile
  $script:CfToken = $user['CLOUDFLARE_API_TOKEN']
  if (-not $script:CfToken) { throw 'Set CLOUDFLARE_API_TOKEN in .env.local.' }
  $accountId = Get-CloudflareAccountId $user['CLOUDFLARE_ACCOUNT_ID']
  $tunnelId = Get-OrCreateTunnel $accountId

  $zone = ($user['CF_ZONE'] ?? '').Trim().ToLowerInvariant()
  if (-not $zone) {
    Write-Host ''
    Write-Host 'No domain yet: CF_ZONE in .env.local is empty.'
    Write-Host 'Going public needs a domain added to this Cloudflare account. Then set CF_ZONE=<domain>'
    Write-Host 'and run `tunnel` again: it routes app.<domain> and wp.<domain> through this tunnel.'
    Write-Host 'Until then the stack stays on http://app.appshelf.localhost and http://wp.appshelf.localhost.'
    return
  }
  if ($zone -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+$') { throw "CF_ZONE is not a domain name: $zone" }

  $script:StripeKey = $user['STRIPE_SECRET_KEY']
  if (-not ($script:StripeKey -and $script:StripeKey.StartsWith('sk_test_'))) {
    throw 'STRIPE_SECRET_KEY in .env.local must be a Stripe test-mode key (sk_test_...).'
  }

  $zones = @(Invoke-Cloudflare -Method GET -Path "/zones?name=$zone")
  if ($zones.Count -eq 0) { throw "Zone $zone is not in this Cloudflare account (or the token cannot see it)." }
  $zoneId = $zones[0].id
  $appHost = "app.$zone"
  $wpHost = "wp.$zone"

  Invoke-Cloudflare -Method PUT -Path "/accounts/$accountId/cfd_tunnel/$tunnelId/configurations" -Body @{
    config = @{
      ingress = @(
        @{ hostname = $appHost; service = 'http://web:3000' },
        @{ hostname = $wpHost; service = 'http://wordpress:80' },
        @{ service = 'http_status:404' }
      )
    }
  } | Out-Null
  Write-Host "Ingress: $appHost -> http://web:3000, $wpHost -> http://wordpress:80"

  Sync-TunnelDnsRecord -ZoneId $zoneId -Hostname $appHost -TunnelId $tunnelId
  Sync-TunnelDnsRecord -ZoneId $zoneId -Hostname $wpHost -TunnelId $tunnelId

  $token = Invoke-Cloudflare -Method GET -Path "/accounts/$accountId/cfd_tunnel/$tunnelId/token"
  $secrets = Read-DotEnv $SecretsFile
  $webhookSecret = Sync-StripeWebhook -Url "https://$appHost/api/stripe/webhook" -HaveSecret ([bool]$secrets['STRIPE_WEBHOOK_SECRET'])

  Write-DotEnvValue -Path $SecretsFile -Key 'TUNNEL_TOKEN' -Value $token
  if ($webhookSecret) { Write-DotEnvValue -Path $SecretsFile -Key 'STRIPE_WEBHOOK_SECRET' -Value $webhookSecret }
  Write-DotEnvValue -Path $SecretsFile -Key 'APP_URL' -Value "https://$appHost"
  Write-DotEnvValue -Path $SecretsFile -Key 'WP_DOMAIN' -Value $wpHost
  Write-DotEnvValue -Path $SecretsFile -Key 'WP_PUBLIC_URL' -Value "https://$wpHost"
  Write-DotEnvValue -Path $SecretsFile -Key 'WP_SCHEME' -Value 'https'
  $stored = @('TUNNEL_TOKEN', 'APP_URL', 'WP_DOMAIN', 'WP_PUBLIC_URL', 'WP_SCHEME')
  if ($webhookSecret) { $stored += 'STRIPE_WEBHOOK_SECRET' }
  Write-Host "Stored in .secrets.local: $($stored -join ', ') (values not shown)."
  Write-Host ''
  Write-Host 'Next: `set-domain` (moves an existing WordPress network to the new domain), then `up`.'
}

# --- WordPress domain migration ----------------------------------------------------

# Runs SQL (from stdin, so nothing lands in argv) as MariaDB root against the WordPress DB.
function Invoke-WordPressSql([string]$Sql) {
  $all = @('compose') + (Get-ComposeArgList) + @('exec', '-T', 'mariadb', 'sh', '-c', 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot -N -B wordpress')
  $out = $Sql | & docker @all
  if ($LASTEXITCODE -ne 0) { throw "MariaDB query failed with exit code $LASTEXITCODE" }
  # Callers wrap the result in @(): PowerShell unrolls a one-line result to a string.
  return $out
}

# Points sites.url in the app database (dashboard "Visit" and "Open wp-admin" links)
# at the WordPress base URL. Idempotent; every site lives at <base>/<slug>/.
function Update-AppSiteUrls([string]$BaseUrl) {
  Invoke-Compose @('up', '-d', '--wait', 'postgres')
  # Single-quoted: $$ is PL/pgSQL quoting here, not PowerShell. $BaseUrl is a validated scheme + domain.
  $sql = @'
DO $$
BEGIN
  IF to_regclass('public.sites') IS NOT NULL THEN
    UPDATE sites SET url = '__BASE__/' || slug || '/', updated_at = now()
     WHERE url IS DISTINCT FROM '__BASE__/' || slug || '/';
  END IF;
END $$;
'@.Replace('__BASE__', $BaseUrl)
  $all = @('compose') + (Get-ComposeArgList) + @('exec', '-T', 'postgres', 'psql', '-U', 'appshelf', '-d', 'appshelf', '-v', 'ON_ERROR_STOP=1', '-q')
  $sql | & docker @all
  if ($LASTEXITCODE -ne 0) { throw "Updating site URLs in Postgres failed with exit code $LASTEXITCODE" }
  Write-Host "App database: site links now use $BaseUrl."
}

function Test-DomainName([string]$Domain) {
  return $Domain -match '^[a-z0-9-]+(\.[a-z0-9-]+)+$'
}

function Invoke-SetDomain {
  Initialize-SecretFile
  Import-ComposeConfig
  $newDomain = if ($env:WP_DOMAIN) { $env:WP_DOMAIN.ToLowerInvariant() } else { $LocalWpDomain }
  $newScheme = if ($env:WP_SCHEME) { $env:WP_SCHEME.ToLowerInvariant() } else { 'http' }
  if (-not (Test-DomainName $newDomain)) { throw "WP_DOMAIN is not a domain name: $newDomain" }
  if ($newScheme -notin 'http', 'https') { throw "WP_SCHEME must be http or https: $newScheme" }

  Invoke-Compose @('up', '-d', '--wait', 'mariadb')
  $installed = @(Invoke-WordPressSql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'wordpress' AND table_name = 'wp_site';")
  if ($installed[0] -ne '1') {
    Write-Host "WordPress network not installed yet; wp-init will install it on $newDomain. Nothing to migrate."
    return
  }
  $oldDomain = @(Invoke-WordPressSql 'SELECT domain FROM wp_site WHERE id = 1;')[0]
  $siteUrl = @(Invoke-WordPressSql "SELECT option_value FROM wp_options WHERE option_name = 'siteurl';")[0]
  $oldScheme = if ($siteUrl -like 'https://*') { 'https' } else { 'http' }
  if (-not (Test-DomainName $oldDomain)) { throw "Unexpected current network domain: $oldDomain" }
  if ($oldDomain -eq $newDomain -and $oldScheme -eq $newScheme) {
    Write-Host "WordPress network already on $newScheme`://$newDomain. Nothing to migrate."
    # A run that stopped after the WordPress move still needs the app links fixed.
    Update-AppSiteUrls "$newScheme`://$newDomain"
    return
  }
  Write-Host "Moving the WordPress network: $oldScheme`://$oldDomain -> $newScheme`://$newDomain"

  # Nothing may write to the DB during the move; `up` starts them again.
  Invoke-Compose @('stop', 'wordpress', 'worker')

  $backupDir = Join-Path $Root 'backups'
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  $backupName = "wordpress-$oldDomain-$(Get-Date -Format 'yyyyMMdd-HHmmss').sql"
  $dump = '/tmp/appshelf-wordpress-backup.sql'
  Invoke-Compose @('exec', '-T', 'mariadb', 'sh', '-c', "MYSQL_PWD=`"`$MARIADB_ROOT_PASSWORD`" mariadb-dump -uroot --single-transaction --routines wordpress > $dump")
  Invoke-Compose @('cp', "mariadb:$dump", (Join-Path $backupDir $backupName))
  Invoke-Compose @('exec', '-T', 'mariadb', 'rm', '-f', $dump)
  $backupSize = (Get-Item (Join-Path $backupDir $backupName)).Length
  if ($backupSize -lt 1024) { throw "Backup looks empty ($backupSize bytes); stopping before any change." }
  Write-Host "Backup: backups/$backupName ($([math]::Round($backupSize / 1KB)) KB)"

  # Domain columns first, so wp-cli can boot the network on the new domain.
  Invoke-WordPressSql @"
UPDATE wp_site SET domain = '$newDomain' WHERE domain = '$oldDomain';
UPDATE wp_blogs SET domain = '$newDomain' WHERE domain = '$oldDomain';
"@ | Out-Null

  # Then every URL in every network table (serialized data aware). GUIDs stay as they are.
  $replace = 'APPSHELF_WP_DIR=/opt/appshelf/wp; . /opt/appshelf/wp/lib.sh; ' +
    'wp_cli search-replace "$OLD_URL" "$NEW_URL" --network --skip-columns=guid --url="$NEW_URL/" --report-changed-only'
  Invoke-Compose @('run', '--rm', '--no-deps', '-T', '--entrypoint', 'sh',
    '-e', "WP_DOMAIN=$newDomain", '-e', "OLD_URL=$oldScheme`://$oldDomain", '-e', "NEW_URL=$newScheme`://$newDomain",
    'wp-init', '-c', $replace)

  Update-AppSiteUrls "$newScheme`://$newDomain"

  Write-Host "Done. Run ``up`` to start WordPress on $newScheme`://$newDomain. Restore with the backup if needed."
}

# --- commands ----------------------------------------------------------------------

switch ($Command) {
  'init' { Initialize-SecretFile }
  'up' {
    $buildLocally = $Build.IsPresent -or ($Rest -contains '--build')
    Invoke-Up $buildLocally @($Rest | Where-Object { $_ -ne '--build' })
  }
  'down' { Import-ComposeConfig; Invoke-Compose (@('down') + $Rest) }
  'ps' { Import-ComposeConfig; Invoke-Compose @('ps') }
  'logs' { Import-ComposeConfig; Invoke-Compose (@('logs', '-f', '--tail', '200') + $Rest) }
  'dc' { Import-ComposeConfig; Invoke-Compose $Rest }
  'tunnel' { Invoke-Tunnel }
  'set-domain' { Invoke-SetDomain }
}
