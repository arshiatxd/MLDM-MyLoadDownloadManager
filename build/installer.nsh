!ifndef BUILD_UNINSTALLER
  !include "WordFunc.nsh"
  Var MyLoadOptionsDialog
  Var MyLoadDesktopShortcutCheckbox
  Var MyLoadDesktopShortcutState

  !macro customInit
    StrCpy $MyLoadDesktopShortcutState 1
  !macroend

  !macro customPageAfterChangeDir
    !include nsDialogs.nsh

    PageEx custom
      PageCallbacks MyLoadOptionsPageCreate MyLoadOptionsPageLeave
    PageExEnd

    Function MyLoadOptionsPageCreate
      !insertmacro MUI_HEADER_TEXT "Additional Options" "Choose shortcut preferences for MyLoad Download Manager."
      nsDialogs::Create 1018
      Pop $MyLoadOptionsDialog
      ${If} $MyLoadOptionsDialog == error
        Abort
      ${EndIf}

      ${NSD_CreateLabel} 0u 0u 300u 18u "Select additional tasks to perform while installing MyLoad Download Manager:"
      Pop $0

      ${NSD_CreateCheckbox} 12u 24u 280u 14u "Create a Desktop shortcut"
      Pop $MyLoadDesktopShortcutCheckbox
      ${NSD_SetState} $MyLoadDesktopShortcutCheckbox $MyLoadDesktopShortcutState

      ${NSD_CreateLabel} 12u 48u 280u 32u "MyLoad Download Manager will also be configured to start automatically with Windows so browser downloads are captured right away. You can turn this off anytime in Preferences."
      Pop $0

      nsDialogs::Show
    FunctionEnd

    Function MyLoadOptionsPageLeave
      ${NSD_GetState} $MyLoadDesktopShortcutCheckbox $MyLoadDesktopShortcutState
    FunctionEnd
  !macroend
!endif

!macro customInstall
  ${If} $MyLoadDesktopShortcutState == 1
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
  ${Else}
    IfFileExists "$DESKTOP\${SHORTCUT_NAME}.lnk" 0 +3
      WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
      Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${EndIf}

  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MyLoad"
  ClearErrors
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MyLoad Download Manager" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --startup'

  CreateDirectory "$LOCALAPPDATA\MyLoad\native-host"
  FileOpen $R1 "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.cmd" w
  FileWrite $R1 '@echo off$\r$\nsetlocal$\r$\nset "ELECTRON_RUN_AS_NODE=1"$\r$\nset "MYLOAD_LAUNCH_EXE=$INSTDIR\${APP_EXECUTABLE_FILENAME}"$\r$\nset "MYLOAD_USER_DATA_DIR=$APPDATA\myload"$\r$\n"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\native-host.cjs" %*$\r$\n'
  FileClose $R1

  ${WordReplace} "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.cmd" "\" "\\" "+" $R0
  FileOpen $R1 "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.json" w
  FileWrite $R1 '{"name":"com.myload.host","description":"MyLoad Download Manager Native Launch Host","path":"$R0","type":"stdio","allowed_origins":["chrome-extension://cbnkknogojpgeikfeaploefenabcgiai/"]}$\r$\n'
  FileClose $R1

  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.myload.host" "" "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.myload.host" "" "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.json"
  WriteRegStr HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.myload.host" "" "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.json"
  WriteRegStr HKCU "Software\Chromium\NativeMessagingHosts\com.myload.host" "" "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.json"
  WriteRegStr HKCU "Software\Vivaldi\NativeMessagingHosts\com.myload.host" "" "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.json"
  WriteRegStr HKCU "Software\Opera Software\Opera Stable\NativeMessagingHosts\com.myload.host" "" "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.json"
  WriteRegStr HKCU "Software\Opera Software\Opera GX Stable\NativeMessagingHosts\com.myload.host" "" "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.json"
  WriteRegStr HKCU "Software\Yandex\YandexBrowser\NativeMessagingHosts\com.myload.host" "" "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.json"
  WriteRegStr HKLM "Software\Google\Chrome\NativeMessagingHosts\com.myload.host" "" "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.json"
  WriteRegStr HKLM "Software\Microsoft\Edge\NativeMessagingHosts\com.myload.host" "" "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.json"

  WriteRegStr HKCU "Software\Classes\myload" "" "URL:MyLoad Protocol"
  WriteRegStr HKCU "Software\Classes\myload" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\myload\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKLM "Software\Classes\myload" "" "URL:MyLoad Protocol"
  WriteRegStr HKLM "Software\Classes\myload" "URL Protocol" ""
  WriteRegStr HKLM "Software\Classes\myload\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MyLoad Download Manager"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MyLoad"
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.myload.host"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.myload.host"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.myload.host"
  DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\com.myload.host"
  DeleteRegKey HKCU "Software\Vivaldi\NativeMessagingHosts\com.myload.host"
  DeleteRegKey HKCU "Software\Opera Software\Opera Stable\NativeMessagingHosts\com.myload.host"
  DeleteRegKey HKCU "Software\Opera Software\Opera GX Stable\NativeMessagingHosts\com.myload.host"
  DeleteRegKey HKCU "Software\Yandex\YandexBrowser\NativeMessagingHosts\com.myload.host"
  DeleteRegKey HKLM "Software\Google\Chrome\NativeMessagingHosts\com.myload.host"
  DeleteRegKey HKLM "Software\Microsoft\Edge\NativeMessagingHosts\com.myload.host"
  DeleteRegKey HKCU "Software\Classes\myload"
  DeleteRegKey HKLM "Software\Classes\myload"
  Delete "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.json"
  Delete "$LOCALAPPDATA\MyLoad\native-host\com.myload.host.cmd"
  Delete "$LOCALAPPDATA\MyLoad\native-host\native-host.cjs"
  RMDir "$LOCALAPPDATA\MyLoad\native-host"
  RMDir "$LOCALAPPDATA\MyLoad"
  ClearErrors
  IfFileExists "$DESKTOP\${SHORTCUT_NAME}.lnk" 0 +3
    WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
!macroend
