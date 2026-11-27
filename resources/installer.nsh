; 安装位置固定在 Program Files\llm meter
!macro customInit
  StrCpy $INSTDIR "$PROGRAMFILES64\llm meter"
!macroend

!macro customInstall
  ; 普通用户需要能在安装目录写 data（数据库与配置）
  ExecWait 'icacls "$INSTDIR" /grant *S-1-5-32-545:(OI)(CI)M'
!macroend

!macro customRemoveFiles
  ; 卸载保留 data 目录，重装不丢历史数据
  ${if} ${FileExists} "$INSTDIR\data\*.*"
    Rename "$INSTDIR\data" "$INSTDIR\..\llm-meter-data-keep"
    RMDir /r "$INSTDIR"
    CreateDirectory "$INSTDIR"
    Rename "$INSTDIR\..\llm-meter-data-keep" "$INSTDIR\data"
  ${else}
    RMDir /r "$INSTDIR"
  ${endif}
!macroend
