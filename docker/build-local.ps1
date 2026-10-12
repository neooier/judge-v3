param([string]$Image = '12oj-judge:noilinux2', [switch]$NoRootfs)
$ErrorActionPreference = 'Stop'
$repoDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sandboxDirectory = [IO.Path]::GetFullPath((Join-Path $repoDirectory '../simple-sandbox'))
$package = Get-Content -LiteralPath (Join-Path $repoDirectory 'package.json') -Raw | ConvertFrom-Json
$sandboxCommit = $package.dependencies.'simple-sandbox'.Split('#')[-1]
git -C $sandboxDirectory cat-file -e "$sandboxCommit`^{commit}"
if ($LASTEXITCODE -ne 0) { throw 'Pinned sandbox commit is missing from the sibling checkout.' }
$dockerArguments = @('buildx', 'build', '--load', '--platform', 'linux/amd64', '--progress', 'plain',
    '--build-context', "sandbox-source=$sandboxDirectory", '--build-arg', 'SANDBOX_SOURCE=local',
    '--tag', $Image, '--file', (Join-Path $repoDirectory 'Dockerfile'))
if ($NoRootfs) { $dockerArguments += @('--target', 'judge-no-rootfs') }
$dockerArguments += $repoDirectory
& docker @dockerArguments
if ($LASTEXITCODE -ne 0) { throw 'Docker build failed.' }
