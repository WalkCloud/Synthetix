; Synthetix Windows installer (Inno Setup).
; Builds a setup.exe from the prepared bundle at dist\app.
; Compile with:  iscc packaging\Synthetix.iss
;
; Design choices:
;  - Installs per-user to %LOCALAPPDATA%\Programs\Synthetix (no admin / UAC),
;    because the app writes its DB, documents and RAG data inside the install dir.
;  - The bundled node.exe + Python runtime mean recipients need NOTHING else
;    installed (they only configure their own LLM/Embedding API keys in-app).
;  - .env and data\ are generated at runtime by first-run.js, so they are
;    excluded from the payload (never ship dev secrets / dev DB).

#define MyAppName "Synthetix"
#define MyAppVersion "1.0.0"
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
Compression=lzma2/normal
SolidCompression=yes
LZMAUseSeparateProcess=yes
WizardStyle=modern
OutputDir=..\dist\installer
OutputBaseFilename=Synthetix-Setup-v1.0.0
UninstallDisplayIcon={app}\runtime\node.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; The entire prepared bundle (node_modules, .next, runtime\python, runtime\node.exe,
; workers, prisma, start.bat, stop.bat, first-run.js, package.json ...).
; "data" and ".env" are runtime-generated, so they are never shipped.
Source: "..\dist\app\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "data,data\*,.env,.env.*"

[Icons]
Name: "{group}\Synthetix"; Filename: "{app}\start.bat"; WorkingDir: "{app}"; IconFilename: "{app}\runtime\node.exe"; Comment: "Start Synthetix"
Name: "{group}\Stop Synthetix"; Filename: "{app}\stop.bat"; WorkingDir: "{app}"; Comment: "Stop Synthetix"
Name: "{group}\{cm:UninstallProgram,Synthetix}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\Synthetix"; Filename: "{app}\start.bat"; WorkingDir: "{app}"; IconFilename: "{app}\runtime\node.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\start.bat"; WorkingDir: "{app}"; Description: "Launch Synthetix now"; Flags: nowait postinstall shellexec skipifsilent

[UninstallRun]
; Stop the server before uninstalling so files aren't locked.
Filename: "{app}\stop.bat"; WorkingDir: "{app}"; Flags: runhidden
