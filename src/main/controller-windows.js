'use strict';

// Fixed scripts only. Renderer values are never interpolated into PowerShell source.
const WINDOWS_ENUM_SCRIPT = String.raw`
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
try {
  $items = @(Get-PnpDevice -PresentOnly | Where-Object {
    $_.FriendlyName -match '(?i)(Xbox|gamepad|game\s*controller|wireless controller|pro controller|joystick|DualSense|DualShock|8BitDo|Stadia)' -and
    $_.FriendlyName -notmatch '(?i)(host controller|wireless adapter|wireless receiver|wireless dongle)'
  } | ForEach-Object {
    $device = $_
    $battery = $null
    $transport = 'usb'
    $ancestorId = $device.InstanceId
    for ($depth = 0; $depth -lt 8 -and $ancestorId; $depth++) {
      if ($ancestorId -match '(?i)^(BTHENUM|BTHLEDEVICE)\\') { $transport = 'bluetooth' }
      if ($ancestorId -match '(?i)^USB\\VID_045E&PID_(02E6|02FE)') { $transport = 'dongle' }
      if ($null -eq $battery) {
        $value = (Get-PnpDeviceProperty -InstanceId $ancestorId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2' -ErrorAction SilentlyContinue).Data
        if ($null -ne $value -and $value -is [ValueType]) { $battery = $value }
      }
      $parentId = (Get-PnpDeviceProperty -InstanceId $ancestorId -KeyName 'DEVPKEY_Device_Parent' -ErrorAction SilentlyContinue).Data
      if ($parentId -eq $ancestorId) { break }
      $ancestorId = $parentId
    }
    [pscustomobject]@{ Name = $device.FriendlyName; InstanceId = $device.InstanceId; Status = $device.Status; Transport = $transport; Battery = $battery; Charging = $false }
  })
  ConvertTo-Json -InputObject $items -Compress
} catch { throw } finally { }
`;

const WINDOWS_RADIO_SCRIPT = String.raw`
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
try {
  $radios = @(Get-CimInstance Win32_PnPEntity -Filter "PNPClass='Bluetooth'" | Where-Object {
    $_.Service -match '(?i)(bthusb|bthmini|ibtusb|rtkbt|qcbt)'
  } | ForEach-Object { [pscustomobject]@{ Disabled = ($_.ConfigManagerErrorCode -ne 0) } })
  ConvertTo-Json -InputObject $radios -Compress
} catch { throw } finally { }
`;

const WINDOWS_DONGLE_SCRIPT = String.raw`
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
try {
  $items = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '(?i)^USB\\VID_045E&PID_(02E6|02FE)' })
  [pscustomobject]@{ Present = ($items.Count -gt 0) } | ConvertTo-Json -Compress
} catch { throw } finally { }
`;

module.exports = { WINDOWS_ENUM_SCRIPT, WINDOWS_RADIO_SCRIPT, WINDOWS_DONGLE_SCRIPT };
