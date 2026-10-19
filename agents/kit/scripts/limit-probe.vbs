' Runs limit-probe.sh in Git Bash with no visible window. Scheduled through wscript.exe (see agent-kit CLI.md, "Limit probe").
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "D:\Github Repos\Home-Media-Launcher"
shell.Run """C:\Program Files\Git\bin\bash.exe"" -lc ""cd '/d/Github Repos/Home-Media-Launcher' && bash agents/kit/scripts/limit-probe.sh""", 0, True
