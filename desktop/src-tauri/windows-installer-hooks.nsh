!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running Beya sidecars..."
  nsExec::ExecToLog 'taskkill /F /T /IM beya-sidecar-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM beya-sidecar-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM beya-sidecar.exe'
  Pop $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping running Beya processes..."
  nsExec::ExecToLog 'taskkill /F /T /IM beya-desktop.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM beya-sidecar-x86_64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM beya-sidecar-aarch64-pc-windows-msvc.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM beya-sidecar.exe'
  Pop $0
  Sleep 1000
!macroend
