@echo off
:: Script instalador del host de Native Messaging en Windows

:: Obtener la ruta absoluta de este directorio
set "DIR=%~dp0"
:: Remover barra diagonal final
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"

set "JSON_PATH=%DIR%\com.merke.twoxscreen.json"
:: Reemplazar contrabarras simples por contrabarras dobles para el formato JSON
set "JSON_PATH_ESC=%JSON_PATH:\=\\%"

:: Crear registro para Google Chrome y Microsoft Edge
REG ADD "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.merke.twoxscreen" /ve /t REG_SZ /d "%JSON_PATH%" /f
REG ADD "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.merke.twoxscreen" /ve /t REG_SZ /d "%JSON_PATH%" /f

echo Host nativo registrado con exito para Chrome y Edge en el Registro de Windows.
pause
