# Run this ONCE to permanently store env vars for your Windows user account.
# After running, restart any open terminals to pick up the changes.

param(
    [string]$CfAccountId,
    [string]$CfGatewayName,
    [string]$CfAigToken,
    [string]$ChromeCdpUrl = "http://127.0.0.1:9222"
)

if (-not $CfAccountId)   { $CfAccountId   = Read-Host "CF_ACCOUNT_ID" }
if (-not $CfGatewayName) { $CfGatewayName = Read-Host "CF_GATEWAY_NAME" }
if (-not $CfAigToken)    { $CfAigToken    = Read-Host "CF_AIG_TOKEN (input hidden)" -AsSecureString | ForEach-Object { [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) } }

[Environment]::SetEnvironmentVariable("CF_ACCOUNT_ID",   $CfAccountId,   "User")
[Environment]::SetEnvironmentVariable("CF_GATEWAY_NAME", $CfGatewayName, "User")
[Environment]::SetEnvironmentVariable("CF_AIG_TOKEN",    $CfAigToken,    "User")
[Environment]::SetEnvironmentVariable("CHROME_CDP_URL",  $ChromeCdpUrl,  "User")

Write-Host "`nEnv vars saved. Open a new terminal to use them." -ForegroundColor Green
Write-Host "CF_ACCOUNT_ID   = $CfAccountId"
Write-Host "CF_GATEWAY_NAME = $CfGatewayName"
Write-Host "CF_AIG_TOKEN    = [hidden]"
Write-Host "CHROME_CDP_URL  = $ChromeCdpUrl"
