# VPN control (Tailscale and Surfshark)

The quick-settings panel toggles two VPNs. Tailscale uses its CLI. Surfshark has no official command line, so the launcher drives a standard VPN client that you configure once with a Surfshark profile. Nothing is installed or changed by the launcher itself, and credentials are never read, logged or stored by it.

## Settings

```json
"settings": {
  "vpn": {
    "surfsharkMode": "auto",
    "surfsharkProfile": "Surfshark"
  }
}
```

| Key | Values | Meaning |
| --- | --- | --- |
| `surfsharkMode` | `auto` (default), `rasdial`, `wireguard-service`, `openvpn-gui`, `nmcli` | Strategy to use. `auto` picks the first one that works. |
| `surfsharkProfile` | profile / tunnel / config name | Name in the chosen client. Letters, digits, space and `. _ @ + -`, up to 64 characters, starting with a letter or digit. |
| `surfsharkWireguardProfile` | same | Legacy alias of `surfsharkProfile`, still honoured. |

Detection order for `auto`: Windows built-in VPN (`rasdial`), WireGuard tunnel service, OpenVPN GUI (only when `surfsharkProfile` is set). On Linux it is always `nmcli`. Without `surfsharkProfile`, the first profile whose name contains "surfshark" is used.

## The official Surfshark app on Windows

Investigated on Windows 11 with Surfshark 6.20: the app (`Surfshark.exe`, background service `Surfshark Service`) registers a `surfshark://` protocol handler, but it has no documented command line, URI action or service control for connect or disconnect. Its configuration folder is access-protected. The launcher therefore does not try to script it; it shows "The Surfshark app cannot be scripted" and asks for one of the profiles below. You can keep the app installed; just do not run it and a launcher-driven profile at the same time.

## Windows

### Option 1 (recommended): built-in Windows VPN (IKEv2), `rasdial`

No admin rights, no extra software. Status comes from `Get-VpnConnection`, toggling from `rasdial "<profile>"` and `rasdial "<profile>" /disconnect`.

1. Sign in at my.surfshark.com, open VPN > Manual setup > Windows (or Router) > Locations, and note your **service credentials** (username and password for manual setup; these differ from your account login). The same page lists server hostnames such as `uk-lon.prod.surfshark.com`.
2. Windows Settings > Network & internet > VPN > Add VPN:
   - VPN provider: Windows (built-in)
   - Connection name: `Surfshark` (or anything containing "Surfshark")
   - Server name: the hostname from step 1
   - VPN type: IKEv2
   - Type of sign-in info: User name and password, enter the service credentials, tick **Remember my sign-in info**.
3. Press Connect once in Windows to prove it works, then Disconnect.
4. Optional: set `"surfsharkMode": "rasdial"` and `"surfsharkProfile": "<connection name>"`.

Optional scripted version (untested by the launcher authors; creating the profile in Settings is the verified route). Run in PowerShell, no admin needed:

```powershell
Add-VpnConnection -Name 'Surfshark' -ServerAddress 'uk-lon.prod.surfshark.com' `
  -TunnelType IKEv2 -AuthenticationMethod Eap -EncryptionLevel Required -RememberCredential
```

You still have to enter the credentials once in Settings. If Windows reports a certificate error (13801), install the root certificate offered on Surfshark's manual IKEv2 setup page.

Error messages shown in the panel: 691 means the saved credentials were rejected, 868/619/651 mean the server could not be reached.

### Option 2: WireGuard tunnel service

Fast and light, but controlling a Windows service needs admin rights once.

1. Install WireGuard for Windows (wireguard.com/install).
2. On the Surfshark account page: VPN > Manual setup > Windows > WireGuard, choose a location, generate a key pair and download the `.conf` file. Rename it to a short name without spaces, for example `surfshark-uk.conf`. The tunnel name is the file name without `.conf`.
3. In an **administrator** PowerShell, install the tunnel service:

   ```powershell
   & "C:\Program Files\WireGuard\wireguard.exe" /installtunnelservice "C:\path\to\surfshark-uk.conf"
   ```

4. Still as administrator, let your normal user start and stop that service, and stop it starting at every boot (otherwise the VPN would always be on):

   ```powershell
   sc config "WireGuardTunnel$surfshark-uk" start= demand
   sc sdset "WireGuardTunnel$surfshark-uk" "D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWRPWPLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)"
   ```

   The security descriptor keeps the default rights for SYSTEM and Administrators and adds query, start and stop for interactive users (`IU`). If the launcher ever shows "Access denied - run once as admin: sc sdset ...", run exactly that command as administrator. Reinstalling a tunnel recreates the service, so repeat step 4 afterwards.
5. Optional: `"surfsharkMode": "wireguard-service"`, `"surfsharkProfile": "surfshark-uk"`.

The launcher then runs `sc.exe start|stop "WireGuardTunnel$surfshark-uk"` and waits up to six seconds for the state change. To remove the tunnel: `wireguard.exe /uninstalltunnelservice surfshark-uk` (admin).

### Option 3: OpenVPN GUI

1. Install OpenVPN (openvpn.net/community-downloads), which includes OpenVPN GUI.
2. On the Surfshark account page: VPN > Manual setup > Windows > OpenVPN, download a `.ovpn` file (UDP) for a location and save the service credentials to a file or enter them when prompted.
3. Copy the file to `%USERPROFILE%\OpenVPN\config\surfshark-fr.ovpn`. To connect without a prompt, add `auth-user-pass surfshark-auth.txt` to it and put the username and password on two lines in that text file next to it, restricting access to your user.
4. Set `"surfsharkMode": "openvpn-gui"` and `"surfsharkProfile": "surfshark-fr"` (the file name without `.ovpn`). `auto` only considers this option when `surfsharkProfile` is set.

The launcher runs `openvpn-gui.exe --command connect|disconnect surfshark-fr`. OpenVPN GUI cannot be queried per profile, so "connected" means that `openvpn.exe` is running. OpenVPN GUI normally requires membership of the "OpenVPN Administrators" group or interactive-service rights; follow the installer's prompts.

## Linux

Uses NetworkManager (`nmcli`); this behaviour is unchanged.

1. On the Surfshark account page: VPN > Manual setup > Linux (or Router) > WireGuard, generate a key pair and download the `.conf` file for a location.
2. Import it: `nmcli connection import type wireguard file surfshark-uk.conf`. NetworkManager names the connection after the file, so keep "surfshark" in the name, or set `surfsharkProfile`.
3. Allow your user to manage the connection without a password prompt (a polkit rule or `nmcli connection modify surfshark-uk connection.permissions user:$USER`).
4. Optional: `"surfsharkMode": "nmcli"`.

## What each state means in the panel

| Panel message | Fix |
| --- | --- |
| The Surfshark app cannot be scripted. Add a Windows VPN (IKEv2) profile... | Follow Option 1. |
| No Surfshark profile in Windows VPN settings | Create a profile whose name contains "Surfshark", or set `surfsharkProfile`. |
| Access denied - run once as admin: sc sdset ... | Run the printed command in an administrator terminal (Option 2, step 4). |
| WireGuard tunnel "x" is not installed | Run the `/installtunnelservice` step. |
| Sign-in rejected | Re-enter the service credentials (not the account login) in Windows VPN settings. |
| surfsharkMode "x" is Windows only / Linux only | Remove the setting or use a mode for your platform. |

## Security notes

All commands run through `execFile` with argument arrays (no shell). Profile names are validated before use. The only PowerShell script is a fixed constant that lists VPN profile names and connection state. Credentials stay in Windows, WireGuard or OpenVPN storage and are never read by the launcher.
