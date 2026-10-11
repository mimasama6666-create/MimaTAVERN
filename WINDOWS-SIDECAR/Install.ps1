param([string]$Destination='')
. (Join-Path $PSScriptRoot 'Common.ps1')
$target=Get-MimaTarget $Destination
if(Test-Path $target){if(Test-Path (Join-Path $target '.mima-sidecar-install.json')){Write-Host "已有受管理安装，不重复安装：$target";exit 0};throw "E_SIDE_CAR_EXISTING: $target 已存在，此工具绝不覆盖未识别目录"}
if(-not (Get-Command git -ErrorAction SilentlyContinue)){throw 'E_SIDE_CAR_NO_GIT: 需要 Git for Windows'}
if(-not (Get-Command npm -ErrorAction SilentlyContinue)){throw 'E_SIDE_CAR_NO_NPM: 需要 npm'}
Assert-Node
$parent=Split-Path $target -Parent
if(-not (Test-Path $parent)){New-Item -ItemType Directory -Path $parent -Force | Out-Null}
$stage="$target.mima-stage-$([guid]::NewGuid().ToString('N'))"
Write-Host "官方来源 $($Script:Lock.source) tag $($Script:Lock.tag)；独立目标 $target"
Write-Host '此安装会从 GitHub 下载官方代码并运行该项目的 npm ci。不会覆盖已有数据，网络失败会保留 stage 供人工检查。'
try {
 & git clone --depth 1 --branch $Script:Lock.tag --single-branch $Script:Lock.source $stage
 if($LASTEXITCODE -ne 0){throw 'E_SIDE_CAR_DOWNLOAD_FAILED: 官方仓库下载失败'}
 $sha=(& git -C $stage rev-parse HEAD).Trim()
 if($LASTEXITCODE -ne 0 -or $sha -notlike "$($Script:Lock.verifiedReleaseCommitPrefix)*"){throw "E_SIDE_CAR_HASH_MISMATCH: tag 的 commit 不符合锁定的签名 release 指纹 ($sha)"}
 if($Script:Lock.fullCommitSha -and $sha -ne $Script:Lock.fullCommitSha){throw 'E_SIDE_CAR_HASH_MISMATCH: full SHA mismatch'}
 Push-Location $stage
 try{& npm ci --no-audit --no-fund;if($LASTEXITCODE -ne 0){throw 'E_SIDE_CAR_NPM_FAILED: npm ci 失败'}}finally{Pop-Location}
 $record=@{owner='MimaTAVERN-Sidecar';installedUtc=[DateTime]::UtcNow.ToString('o');sha=$sha;tag=$Script:Lock.tag;source=$Script:Lock.source;dataMutation='none'}|ConvertTo-Json
 Set-Content -Path (Join-Path $stage '.mima-sidecar-install.json') -Value $record -Encoding UTF8
 if(Test-Path $target){throw 'E_SIDE_CAR_RACE: 安装期间目标被创建，拒绝覆盖'}
 Move-Item -LiteralPath $stage -Destination $target
 Write-Host "安装完成：$target`nSHA: $sha`n请运行 Launch.cmd 独立启动。"
} catch {Write-Warning "安装未完成：$($_.Exception.Message)";if(Test-Path $stage){Write-Warning "仅保留未完成 staging：$stage（未触及旧安装）"};throw}
