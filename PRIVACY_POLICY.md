# Política de Privacidad

Esta política de privacidad describe cómo se maneja la información en las extensiones de Chrome desarrolladas para este ecosistema, incluyendo **Mk 2xScreen**, **Mk VideoPlayer**, **Mk Visor de Imágenes (ImagePlayer)**, **Mk Agenda & Notas (Notes)** y **Mk ScreenShot**.

## 1. Recopilación de Información
**Ninguna de nuestras extensiones recopila, almacena, rastrea ni comparte datos personales, información de navegación ni ningún tipo de información sensible del usuario.** 

El desarrollo está estructurado bajo la filosofía de privacidad absoluta y autonomía del usuario.

## 2. Almacenamiento Local (Local Only)
Toda la información generada, procesada o accedida por las extensiones se almacena y procesa **únicamente de forma local** en el dispositivo del usuario:
* **Marcadores y Zoom**: Se gestionan localmente en el navegador a través del almacenamiento interno y las APIs nativas de Chrome (`chrome.storage.local`).
* **Notas, Agenda, Kanban y Ahorros**: Los datos, metas, objetivos de ahorro y configuraciones se guardan de forma exclusiva en el almacenamiento local del navegador del usuario.
* **Vídeos e Imágenes**: El acceso a archivos locales se realiza exclusivamente mediante la API del sistema de archivos del navegador (File System Access API) o mediante reproducción local a solicitud y bajo el control del propio usuario.
* **Capturas de pantalla**: Las capturas se procesan de forma inmediata en el navegador y se guardan únicamente donde el usuario decida en su disco local. No se envían a ningún servidor externo.

## 3. Sincronización Opcional con Google Drive
En la extensión **Mk Organizer**, se ofrece la opción voluntaria de realizar copias de seguridad y sincronizar datos a través de **Google Drive**:
* **Uso exclusivo de almacenamiento personal**: La extensión utiliza el flujo seguro OAuth 2.0 de Google (`identity` API) para acceder únicamente a la carpeta dedicada de la aplicación del propio usuario en su cuenta de Google Drive.
* **Control del usuario**: La sincronización es 100% opcional. Si el usuario decide no iniciar sesión o desactivar esta función, la extensión seguirá funcionando localmente sin ninguna restricción.
* **Sin acceso a servidores externos**: El archivo de respaldo se guarda directamente desde la extensión a la nube del usuario en un archivo llamado `mkorganizer_data.json`, sin intermediación de servidores de terceros ni del desarrollador.

## 4. Transmisión a Terceros
No existen servidores externos operados por nosotros vinculados a estas extensiones. Por lo tanto:
* **Cero transmisión de datos**: Ningún fragmento de información se transmite al desarrollador ni a terceras partes.
* **Sin telemetría ni analíticas**: Las extensiones no incluyen scripts de seguimiento, cookies de terceros ni herramientas de telemetría de uso.

## 5. Control del Usuario
El usuario tiene el control absoluto sobre sus datos. Al desinstalar la extensión o borrar los datos de navegación, toda la información local asociada se eliminará de forma definitiva y permanente de su dispositivo. El usuario también puede revocar el acceso a Google Drive en cualquier momento desde la configuración de su cuenta de Google.

---
*Última actualización: Julio de 2026*
