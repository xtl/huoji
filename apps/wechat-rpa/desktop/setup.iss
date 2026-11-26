; build.py reads these versions and shows them at the top of the assistant page.
#define CloudVersion "0.2.2"
#define LocalTestVersion "0.1.1"
#ifdef Cloud
  #define Edition "货记采集助手（云同步版）"
  #define AppKey "HuojiCaptureCloud"
  #define OutputName "Huoji-Capture-Cloud-x64-Setup"
  #define InstallNote "所选群的资料将同步至 huoij.com 登录账号的当前空间。"
#else
  #define Edition "货记采集助手（本机测试版）"
  #define AppKey "HuojiCaptureTest"
  #define OutputName "Huoji-Capture-Local-Test-x64-Setup"
  #define InstallNote "账号和采集结果保存在本机。"
#endif
[Setup]
#ifdef Cloud
AppId=HuojiCaptureCloud
#else
AppId=HuojiCaptureLocalTest
#endif
AppName={#Edition}
#ifdef Cloud
AppVersion={#CloudVersion}
ChangesAssociations=yes
#else
AppVersion={#LocalTestVersion}
#endif
DefaultDirName={localappdata}\Programs\{#AppKey}
DefaultGroupName={#Edition}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
DisableProgramGroupPage=yes
DisableDirPage=yes
Uninstallable=not SmokeTest
OutputBaseFilename={#OutputName}
Compression=lzma2/fast
SolidCompression=yes
UninstallDisplayIcon={app}\HuojiCapture.exe
SetupIconFile={#Stage}\huoji.ico
CloseApplications=yes
RestartApplications=no
WizardStyle=modern

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

#ifdef Cloud
[Registry]
Root: HKCU; Subkey: "Software\Classes\huoji-capture"; ValueType: string; ValueData: "URL:货记采集助手"; Flags: uninsdeletekey; Check: not SmokeTest
Root: HKCU; Subkey: "Software\Classes\huoji-capture"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Check: not SmokeTest
Root: HKCU; Subkey: "Software\Classes\huoji-capture\shell\open\command"; ValueType: string; ValueData: """{app}\HuojiCapture.exe"" --history"; Check: not SmokeTest
#endif

[Icons]
Name: "{group}\货记采集助手"; Filename: "{app}\HuojiCapture.exe"; Check: not SmokeTest
Name: "{autodesktop}\{#Edition}"; Filename: "{app}\HuojiCapture.exe"; Check: not SmokeTest

[Run]
Filename: "{app}\HuojiCapture.exe"; Description: "打开货记采集助手"; Flags: nowait postinstall skipifsilent

[Messages]
BeveledLabel=货记
SetupWindowTitle=安装货记采集助手
WizardReady=准备安装货记采集助手
ReadyLabel1={#InstallNote}
ButtonInstall=安装(&I)
ButtonCancel=取消
ButtonNext=下一步(&N)
ButtonFinish=完成(&F)
WizardFinished=安装完成
FinishedLabel=已安装货记采集助手。打开后即可登录并选择采集群。

[Code]
function SmokeTest: Boolean;
begin
  Result := ExpandConstant('{param:verify|0}') = '1';
end;
