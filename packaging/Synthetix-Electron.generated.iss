; Synthetix Electron installer (Inno Setup).
;
; Wraps electron-builder's win-unpacked/ (Synthetix.exe + resources/app)
; into a setup.exe with non-solid LZMA2 compression.
;
; SolidCompression=no is THE fix for the install stall: electron-builder's
; NSIS packs everything into one 7z and must decompress it entirely before
; extracting the first file. Inno Setup non-solid extracts file-by-file so
; the progress bar moves continuously.
;
; Build: iscc packaging\Synthetix-Electron.iss
;        (normally invoked by scripts/build-electron.mjs)

#define MyAppName "Synthetix"
#define MyAppVersion "0.10.9"
#define MyAppPublisher "Synthetix"

[Setup]
AppId={{7C4A1F9B-3D2E-4A6C-9F01-2B8E5A7D4C33}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SolidCompression=no
Compression=lzma2/normal
LZMAUseSeparateProcess=yes
WizardStyle=modern
OutputDir=..\dist\installer
OutputBaseFilename=Synthetix-Setup-v0.10.9
UninstallDisplayIcon={app}\Synthetix.exe
UninstallDisplayName=Synthetix

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\electron\win-unpacked\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "\data,\data\*,.env,.env.*"

[Icons]
Name: "{group}\Synthetix"; Filename: "{app}\Synthetix.exe"; WorkingDir: "{app}"; Comment: "Start Synthetix"
Name: "{group}\{cm:UninstallProgram,Synthetix}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Synthetix"; Filename: "{app}\Synthetix.exe"; WorkingDir: "{app}"; Tasks: desktopicon; Comment: "Start Synthetix"

[Run]
Filename: "{app}\Synthetix.exe"; WorkingDir: "{app}"; Description: "{cm:LaunchProgram,Synthetix}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "taskkill"; Parameters: "/IM Synthetix.exe /F /T"; Flags: runhidden; RunOnceId: "KillSynthetix"
