param([string]$Destination='', [int]$Port=8000)
. (Join-Path $PSScriptRoot 'Common.ps1')
$target=Get-MimaTarget $Destination;Assert-Installed $target;Assert-Node;Assert-LoopbackConfig $target
if($Port -ne 8000){throw 'E_SIDE_CAR_PORT_UNSUPPORTED: 未验证 ST CLI 配置端口参数，只支持官方默认 8000（禁止假配置）'}
$running=Read-OwnedProcess $target
if($running){Write-Host "已由本工具运行：PID $($running.ProcessId)";exit 0}
Assert-PortAvailable $Port
$script=[IO.Path]::GetFullPath((Join-Path $target 'server.js'))
$log=Join-Path $target '.mima-sidecar-console.log'
$proc=Start-Process -FilePath (Get-Command node).Source -WorkingDirectory $target -ArgumentList ('"'+$script+'"') -WindowStyle Normal -PassThru
Start-Sleep -Milliseconds 250
try{$live=Get-Process -Id $proc.Id -ErrorAction Stop}catch{throw 'E_SIDE_CAR_START_FAILED: 进程已经退出，查看 Windows 控制台'}
@{pid=$proc.Id;startedUtc=$live.StartTime.ToUniversalTime().ToString('o');script=$script;port=$Port}|ConvertTo-Json|Set-Content -Path (Join-Path $target '.mima-owned-process.json') -Encoding UTF8
Write-Host "已启动属于本工具的进程 PID $($proc.Id)。访问 http://127.0.0.1:$Port；若页面不可用，请查看独立控制台。"
