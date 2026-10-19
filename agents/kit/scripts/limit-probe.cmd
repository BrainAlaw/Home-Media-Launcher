@echo off
rem Runs limit-probe.sh inside Git Bash, from the project folder. Scheduled every 30 minutes (see agent-kit CLI.md).
"C:\Program Files\Git\bin\bash.exe" -lc "cd '/d/Github Repos/Home-Media-Launcher' && bash agents/kit/scripts/limit-probe.sh"
