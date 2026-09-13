<#
.SYNOPSIS
  Extract every business table of the legacy MS Access POS database to JSONL + manifest.json.
  ดึงข้อมูลทุกตารางจากฐานข้อมูล MS Access เดิม ออกเป็นไฟล์ JSONL (UTF-8) พร้อม manifest สำหรับนำเข้าระบบใหม่

.DESCRIPTION
  Runs on Windows only (needs the 64-bit "Microsoft Access Driver (*.mdb, *.accdb)" ODBC driver, shipped with
  Office / Access Database Engine). Opens the file READ-ONLY, never modifies it.
  Output: <Out>\<table>.jsonl (one JSON object per row, autonumber order where present) and <Out>\manifest.json.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\legacy-extract\extract.ps1 -Mdb D:\workspace\pos\database.mdb -Password <รหัสผ่านไฟล์ .mdb> -Out D:\workspace\pos\legacy-dump
  powershell -File tools\legacy-extract\extract.ps1 -Mdb ... -Out ... -Verify     # recount rows and compare with manifest
  powershell -File tools\legacy-extract\extract.ps1 -Mdb ... -Out ... -SkipKeylessRows  # leave out rows with a blank business key
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Mdb,
  [string] $Password = $env:LEGACY_MDB_PASSWORD,
  [Parameter(Mandatory = $true)] [string] $Out,
  [switch] $Verify,
  # -Zip also packs the dump into <Out>.zip, ready to upload on the POS website
  # (ตั้งค่า -> ข้อมูลและการสำรอง -> นำเข้าข้อมูลจากระบบเดิม)
  [switch] $Zip,
  # -SkipKeylessRows leaves out rows whose business key is blank (see $rowKeys). Some shops' Access
  # files collect hundreds of thousands of them — บ้านแก่นใต้ carries 1,046,946 keyless rows in
  # `product`, which is why its file is 114 MB for 3,600 real products — and the importer discards
  # exactly these rows anyway, so writing them costs half an hour for nothing.
  # The manifest records how many were left out, so the dump still accounts for every source row.
  [switch] $SkipKeylessRows
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Tables to export -> ordering column (autonumber) so row order is deterministic and duplicate-bill
# segmentation (buydetails.ID) is reproducible. Tables not listed are skipped on purpose:
#   keyregister (software licence), 'ข้อผิดพลาดในการวาง' (Access paste-error junk), MSys* (system).
$tables = [ordered]@{
  company          = 'company_id'
  usersys          = $null
  brand            = $null
  product          = $null
  delproducts      = 'id'
  supplier         = $null
  customer         = $null
  typepayments     = $null
  buymain          = $null
  buydetails       = 'ID'
  payments         = 'payment_id'
  ordermain        = $null
  orderdetails     = 'id'
  expenses         = 'expen_id'
  expenses_type    = $null
  criteriondividend= 'criteriondividend_id'
  temps            = 'id'
  temps2           = 'id'
  temps3           = 'id'
  chartmonth       = 'chart_id'
  logopencashdrawer= 'log_id'
  saletoday        = 'saletoday_id'
  promotionbill    = 'pm_id'
  promotionproduct = 'pm_id'
  barcodeforms     = 'id'
  barcodes         = 'id'
  barcodeencode    = 'id'
}

# Business key per table, used only by -SkipKeylessRows. A row with no key cannot be imported —
# `stage_products` and friends skip it and count it as skipped — so leaving it out of the dump
# changes nothing downstream. Tables absent from this map are never filtered.
$rowKeys = [ordered]@{
  company     = 'company_id'
  usersys     = 'user_user'
  brand       = 'brand_id'
  product     = 'pro_id'
  delproducts = 'pro_id'
  supplier    = 'sup_id'
  customer    = 'cust_id'
  buymain     = 'buy_id'
}

if (-not (Test-Path $Mdb)) { throw "Access file not found: $Mdb" }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$cs = "Driver={Microsoft Access Driver (*.mdb, *.accdb)};Dbq=$Mdb;Pwd=$Password;ReadOnly=1;"
$conn = New-Object System.Data.Odbc.OdbcConnection($cs)
$conn.Open()

function Get-Sha256([string] $path) {
  $h = [System.Security.Cryptography.SHA256]::Create()
  $fs = [System.IO.File]::OpenRead($path)
  try { ([BitConverter]::ToString($h.ComputeHash($fs))).Replace('-', '').ToLowerInvariant() } finally { $fs.Dispose() }
}

# Hand-rolled JSON encoder: ConvertTo-Json per row is ~50x slower on 585K-row tables.
$script:inv = [System.Globalization.CultureInfo]::InvariantCulture
$script:ctrlRx = New-Object System.Text.RegularExpressions.Regex('[\x00-\x1f]', 'Compiled')
$script:ctrlEval = [System.Text.RegularExpressions.MatchEvaluator]{
  param($m)
  switch ($m.Value) {
    "`n" { '\n' } "`r" { '\r' } "`t" { '\t' }
    default { '\u{0:x4}' -f [int][char]$m.Value }
  }
}
function Json-String([string] $s) {
  # native string.Replace is ~100x faster than a PowerShell char loop
  $s = $s.Replace('\', '\\').Replace('"', '\"')
  if ($script:ctrlRx.IsMatch($s)) { $s = $script:ctrlRx.Replace($s, $script:ctrlEval) }
  return '"' + $s + '"'
}
function Json-Value($v) {
  if ($v -is [DBNull] -or $null -eq $v) { return 'null' }
  if ($v -is [datetime]) { return '"' + $v.ToString('yyyy-MM-ddTHH:mm:ss') + '"' }   # naive local (Asia/Bangkok) wall time
  if ($v -is [byte[]]) { return '"' + [Convert]::ToBase64String($v) + '"' }
  if ($v -is [bool]) { return $(if ($v) { 'true' } else { 'false' }) }
  if ($v -is [decimal] -or $v -is [double] -or $v -is [single]) { return ([double]$v).ToString('R', $script:inv) }
  if ($v -is [int] -or $v -is [long] -or $v -is [int16] -or $v -is [byte]) { return $v.ToString($script:inv) }
  return Json-String ([string]$v)
}

$manifestPath = Join-Path $Out 'manifest.json'

if ($Verify) {
  if (-not (Test-Path $manifestPath)) { throw "manifest.json not found in $Out" }
  $m = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $bad = 0
  foreach ($t in $m.tables) {
    $cmd = $conn.CreateCommand(); $cmd.CommandText = "SELECT COUNT(*) FROM [$($t.name)]"
    $n = [int]$cmd.ExecuteScalar()
    $file = Join-Path $Out $t.file
    $lines = if (Test-Path $file) { [int](Get-Content $file -Encoding UTF8 | Measure-Object -Line).Lines } else { -1 }
    $expectDb = if ($null -ne $t.source_rows) { [int]$t.source_rows } else { [int]$t.rows }
    $ok = ($n -eq $expectDb) -and ($lines -eq $t.rows)
    if (-not $ok) { $bad++ }
    '{0,-20} db={1,8} manifest={2,8} file={3,8} {4}' -f $t.name, $n, $t.rows, $lines, $(if ($ok) { 'OK' } else { 'MISMATCH' })
  }
  $conn.Close()
  if ($bad -gt 0) { Write-Error "$bad table(s) mismatch"; exit 1 }
  Write-Output 'verify OK'; exit 0
}

$manifest = [ordered]@{
  format          = 'pos-legacy-dump/1'
  extracted_at    = (Get-Date).ToString('o')
  source_path     = (Resolve-Path $Mdb).Path
  source_size     = (Get-Item $Mdb).Length
  source_sha256   = Get-Sha256 $Mdb
  timezone        = 'Asia/Bangkok'
  tables          = @()
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$sw = [Diagnostics.Stopwatch]::StartNew()

foreach ($name in $tables.Keys) {
  $orderBy = $tables[$name]
  $sql = "SELECT * FROM [$name]" + $(if ($orderBy) { " ORDER BY [$orderBy]" } else { '' })
  $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 0
  $reader = $cmd.ExecuteReader()
  $cols = @(); $types = @()
  for ($i = 0; $i -lt $reader.FieldCount; $i++) { $cols += $reader.GetName($i); $types += $reader.GetDataTypeName($i) }
  $file = "$name.jsonl"
  $path = Join-Path $Out $file
  $writer = New-Object System.IO.StreamWriter($path, $false, $utf8NoBom)
  $rows = 0
  $skippedEmpty = 0
  $keyIndex = -1
  if ($SkipKeylessRows -and $rowKeys.Contains($name)) {
    $keyIndex = [array]::IndexOf($cols, $rowKeys[$name])
    if ($keyIndex -lt 0) { Write-Warning "table $name has no column $($rowKeys[$name]); keeping every row" }
  }
  try {
    $vals = New-Object object[] $reader.FieldCount
    $keys = @($cols | ForEach-Object { (Json-String $_) + ':' })
    $sb = New-Object System.Text.StringBuilder
    while ($reader.Read()) {
      [void]$reader.GetValues($vals)
      if ($keyIndex -ge 0) {
        $kv = $vals[$keyIndex]
        if ($kv -is [DBNull] -or $null -eq $kv -or ([string]$kv).Trim().Length -eq 0) { $skippedEmpty++; continue }
      }
      [void]$sb.Clear(); [void]$sb.Append('{')
      for ($i = 0; $i -lt $cols.Count; $i++) {
        if ($i -gt 0) { [void]$sb.Append(',') }
        [void]$sb.Append($keys[$i]); [void]$sb.Append((Json-Value $vals[$i]))
      }
      [void]$sb.Append('}')
      $writer.WriteLine($sb.ToString())
      $rows++
    }
  } finally { $writer.Dispose(); $reader.Close() }
  $entry = [ordered]@{
    name     = $name
    file     = $file
    rows     = $rows
    # rows actually in the table; differs from `rows` only when -SkipKeylessRows dropped some
    source_rows     = $rows + $skippedEmpty
    skipped_keyless = $skippedEmpty
    order_by = $orderBy
    columns  = @(for ($i = 0; $i -lt $cols.Count; $i++) { [ordered]@{ name = $cols[$i]; type = $types[$i] } })
    sha256   = Get-Sha256 $path
  }
  $manifest.tables += $entry
  if ($skippedEmpty -gt 0) {
    '{0,-20} {1,8} rows  ({2}s)  [{3} keyless row(s) left out]' -f $name, $rows, [int]$sw.Elapsed.TotalSeconds, $skippedEmpty
  } else {
    '{0,-20} {1,8} rows  ({2}s)' -f $name, $rows, [int]$sw.Elapsed.TotalSeconds
  }
}

$conn.Close()
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 6), $utf8NoBom)
Write-Output "manifest written: $manifestPath  (total $([int]$sw.Elapsed.TotalSeconds)s)"

if ($Zip) {
  $zipPath = (Join-Path (Split-Path -Parent (Resolve-Path $Out)) ((Split-Path -Leaf (Resolve-Path $Out)) + '.zip'))
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Compress-Archive -Path (Join-Path $Out '*') -DestinationPath $zipPath
  Write-Output "zip written: $zipPath  ($([int]((Get-Item $zipPath).Length / 1MB)) MB) - upload this file on the POS website"
}
