param([string]$Destination='')
. (Join-Path $PSScriptRoot 'Common.ps1')
$target=Get-MimaTarget $Destination
Assert-Installed $target
$record=Get-Content (Join-Path $target '.mima-sidecar-install.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($record.tag -ne $Script:Lock.tag -or $record.source -ne $Script:Lock.source){throw 'E_SIDE_CAR_HASH_MISMATCH: 安装身份与锁不同'}
$actual=(& git -C $target rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $record.sha -ne $actual -or $actual -ne $Script:Lock.fullCommitSha){throw 'E_SIDE_CAR_HASH_MISMATCH: 工作目录 HEAD 与安装记录不符'}
$changes=(& git -C $target status --porcelain -uno)
Write-Host "代码 HEAD：$actual；版本：$($record.tag)；来源：$($record.source)"
if($changes){Write-Warning '工作树有变更（可能含本地插件、配置），此命令不会自动清除或重装'}
Write-Host '只读校验结束；未检查运行时页面、插件行为或 npm 完整性。'
