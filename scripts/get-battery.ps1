[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

try {
    [object[]]$batteries = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop)
    [Nullable[bool]]$onBattery = $null
    [Nullable[double]]$percent = $null
    if ($batteries.Count -gt 0) {
        [double[]]$levels = @($batteries | ForEach-Object { $_.EstimatedChargeRemaining } | Where-Object { $null -ne $_ -and $_ -ge 0 -and $_ -le 100 })
        if ($levels.Count -gt 0) { $percent = ($levels | Measure-Object -Average).Average }
        if (@($batteries | Where-Object { $_.BatteryStatus -eq 1 }).Count -gt 0) {
            $onBattery = $true
        }
        elseif (@($batteries | Where-Object { $_.BatteryStatus -notin @(2, 3, 6, 7, 8, 9, 11) }).Count -eq 0) {
            $onBattery = $false
        }
        # Charge level alone does not establish whether the system uses AC power.
    }
    [PSCustomObject]@{
        present = $batteries.Count -gt 0
        onBattery = $onBattery
        percent = $percent
    } | ConvertTo-Json -Compress
}
catch { throw }
finally { }
