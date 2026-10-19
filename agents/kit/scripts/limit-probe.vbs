' Runs limit-probe.sh in Git Bash with no visible window. Scheduled through wscript.exe (see agent-kit CLI.md, "Limit probe").
' The project folder is found from this file's place: <project>\agents\kit\scripts\limit-probe.vbs
Set fso = CreateObject("Scripting.FileSystemObject")
projectDir = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))))
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = projectDir
shell.Run """C:\Program Files\Git\bin\bash.exe"" -lc ""bash agents/kit/scripts/limit-probe.sh""", 0, True
