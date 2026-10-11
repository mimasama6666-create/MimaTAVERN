param([string]$Destination='')
. (Join-Path $PSScriptRoot 'Common.ps1')
$target=Get-MimaTarget $Destination;Assert-Installed $target
$proc=Read-OwnedProcess $target
if(-not $proc){Write-Host '无受管理的运行中进程，不会结束其他程序';exit 0}
Stop-Process -Id $proc.ProcessId -ErrorAction Stop
Remove-Item -LiteralPath (Join-Path $target '.mima-owned-process.json') -ErrorAction SilentlyContinue
Write-Host "已停止受管理进程 $($proc.ProcessId)；原版 ST 数据未删除。"
