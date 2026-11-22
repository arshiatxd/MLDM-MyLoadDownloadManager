!ifndef BUILD_UNINSTALLER
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
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MyLoad Download Manager"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MyLoad"
  ClearErrors
  IfFileExists "$DESKTOP\${SHORTCUT_NAME}.lnk" 0 +3
    WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
!macroend
