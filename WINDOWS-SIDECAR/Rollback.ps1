param([string]$Destination='')
. (Join-Path $PSScriptRoot 'Common.ps1')
$target=Get-MimaTarget $Destination;Assert-Installed $target
if(Read-OwnedProcess $target){throw '请先 Stop.cmd 关闭受管理进程，再进行回滚'}
$archive="$target.mima-disabled-$(Get-Date -Format yyyyMMddHHmmss)"
if(Test-Path $archive){throw '回滚目录已存在，拒绝覆盖'}
Move-Item -LiteralPath $target -Destination $archive
Write-Host "仅停用本工具安装并重命名至：$archive；原版存档、配置、扩展均完整保留。手动改回名称可恢复。"
