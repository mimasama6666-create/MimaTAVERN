param([Parameter(Mandatory=$true)][string]$TargetDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$target=[IO.Path]::GetFullPath($TargetDirectory)
$index=Join-Path $target 'index.html'
$original=Join-Path $PSScriptRoot 'index-v1.4.0.html'
if(-not(Test-Path $index) -or -not(Test-Path $original)){throw 'E_ROLLBACK_MISSING: 目标原 index 或基线文件不存在'}
$backup="$index.mima-before-rollback-$(Get-Date -Format yyyyMMddHHmmss)"
if(Test-Path $backup){throw 'E_ROLLBACK_COLLISION: 备份文件冲突'}
Copy-Item -LiteralPath $index -Destination $backup -ErrorAction Stop
try{Copy-Item -LiteralPath $original -Destination $index -ErrorAction Stop}catch{Copy-Item -LiteralPath $backup -Destination $index -ErrorAction Stop;throw}
Write-Host "原生 v1.4.0 页面已恢复；新包入口备份：$backup。未触及数据库/卡包/存档。"
