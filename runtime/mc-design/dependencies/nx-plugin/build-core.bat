@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "CONFIGURATION=Release"
if not "%~1"=="" set "CONFIGURATION=%~1"

set "BUILD_EXE="
set "USE_DOTNET="
set "NEWTONSOFT_VERSION=13.0.4"
set "NEWTONSOFT_DIR=%SCRIPT_DIR%\packages\Newtonsoft.Json.%NEWTONSOFT_VERSION%"
set "NEWTONSOFT_ZIP=%SCRIPT_DIR%\offline-packages\Newtonsoft.Json.%NEWTONSOFT_VERSION%.zip"

if not defined UGII_BASE_DIR (
  echo [mc-design] UGII_BASE_DIR is required to build NX projects.
  echo [mc-design] Set UGII_BASE_DIR to the NX install root, for example D:\Siemens\NX 11.0
  exit /b 1
)

set "NXOPEN_DLL=%UGII_BASE_DIR%\nxbin\managed\NXOpen.dll"
if not exist "%NXOPEN_DLL%" (
  echo [mc-design] NX managed DLLs were not found.
  echo [mc-design] Missing: %NXOPEN_DLL%
  echo [mc-design] Set UGII_BASE_DIR to the NX install root, for example D:\Siemens\NX 11.0
  exit /b 1
)

if defined MSBUILD_EXE (
  if exist "%MSBUILD_EXE%" set "BUILD_EXE=%MSBUILD_EXE%"
)

if not defined BUILD_EXE (
  for %%P in (
    "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe"
    "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\MSBuild.exe"
    "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\MSBuild.exe"
    "%ProgramFiles(x86)%\Microsoft Visual Studio\2019\BuildTools\MSBuild\Current\Bin\MSBuild.exe"
    "%ProgramFiles(x86)%\Microsoft Visual Studio\2019\Professional\MSBuild\Current\Bin\MSBuild.exe"
    "%ProgramFiles(x86)%\Microsoft Visual Studio\2019\Enterprise\MSBuild\Current\Bin\MSBuild.exe"
  ) do (
    if not defined BUILD_EXE (
      if exist "%%~P" set "BUILD_EXE=%%~P"
    )
  )
)

if not defined BUILD_EXE (
  where msbuild.exe >nul 2>nul
  if not errorlevel 1 (
    for /f "delims=" %%P in ('where msbuild.exe') do (
      if not defined BUILD_EXE set "BUILD_EXE=%%P"
    )
  )
)

if not defined BUILD_EXE (
  where dotnet.exe >nul 2>nul
  if not errorlevel 1 (
    set "BUILD_EXE=dotnet.exe"
    set "USE_DOTNET=1"
  )
)

if not defined BUILD_EXE (
  echo [mc-design] MSBuild or dotnet msbuild is required to build the NX core projects.
  exit /b 1
)

if not exist "%NEWTONSOFT_DIR%\lib\net45\Newtonsoft.Json.dll" (
  if not exist "%NEWTONSOFT_ZIP%" (
    echo [mc-design] Missing offline package: %NEWTONSOFT_ZIP%
    echo [mc-design] This intranet build does not download NuGet packages. Restore nx-plugin\offline-packages.
    exit /b 1
  )
  echo [mc-design] Restoring Newtonsoft.Json package %NEWTONSOFT_VERSION% from offline package.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $zip='%NEWTONSOFT_ZIP%'; $dir='%NEWTONSOFT_DIR%'; New-Item -ItemType Directory -Force -Path (Split-Path $dir -Parent) | Out-Null; Add-Type -AssemblyName System.IO.Compression.FileSystem; if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }; [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $dir)"
  if errorlevel 1 exit /b 1
)

call :build "%SCRIPT_DIR%\src\McDesign.NXSDK\McDesign.NXSDK.csproj"
if errorlevel 1 exit /b %ERRORLEVEL%
call :build "%SCRIPT_DIR%\src\McDesign.NXTools\McDesign.NXTools.csproj"
if errorlevel 1 exit /b %ERRORLEVEL%
call :build "%SCRIPT_DIR%\src\McDesign.NXPlugin\McDesign.NXPlugin.csproj"
if errorlevel 1 exit /b %ERRORLEVEL%

echo [mc-design] NX core projects built successfully.
exit /b 0

:build
set "PROJECT=%~1"
echo [mc-design] Building %PROJECT%
if defined USE_DOTNET (
  "%BUILD_EXE%" msbuild "%PROJECT%" /p:Configuration=%CONFIGURATION% /p:Platform=x64 /m
) else (
  "%BUILD_EXE%" "%PROJECT%" /p:Configuration=%CONFIGURATION% /p:Platform=x64 /m
)
exit /b %ERRORLEVEL%
