param([string]$Destination='')
. (Join-Path $PSScriptRoot 'Common.ps1')
$target=Get-MimaTarget $Destination
Write-Host "目标：$target"
if(-not (Test-Path (Join-Path $target '.mima-sidecar-install.json'))){Write-Host '未安装或不是本工具受管理的安装';exit 0}
Assert-Installed $target
$record=Get-Content (Join-Path $target '.mima-sidecar-install.json') -Raw -Encoding UTF8|ConvertFrom-Json
Write-Host "版本：$($record.tag)；Commit $($record.sha)"
$proc=Read-OwnedProcess $target
if($proc){Write-Host "正在运行 PID $($proc.ProcessId)"}else{Write-Host '当前没有本工具认证的运行进程'}
