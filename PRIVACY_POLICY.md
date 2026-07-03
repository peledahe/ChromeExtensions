# Política de Privacidad

Esta política de privacidad describe cómo se maneja la información en las extensiones de Chrome desarrolladas para este ecosistema, incluyendo **Mk 2xScreen**, **Mk VideoPlayer**, **Mk Visor de Imágenes (ImagePlayer)**, **Mk Agenda & Notas (Notes)** y **Mk ScreenShot**.

## 1. Recopilación de Información
**Ninguna de nuestras extensiones recopila, almacena, rastrea ni comparte datos personales, información de navegación ni ningún tipo de información sensible del usuario.** 

El desarrollo está estructurado bajo la filosofía de privacidad absoluta y autonomía del usuario.

## 2. Almacenamiento Local (Local Only)
Toda la información generada, procesada o accedida por las extensiones se almacena y procesa **únicamente de forma local** en el dispositivo del usuario:
* **Marcadores y Zoom**: Se gestionan localmente en el navegador a través del almacenamiento interno y las APIs nativas de Chrome (`chrome.storage.local`).
* **Notas, Agenda y Kanban**: Los datos y configuraciones se guardan de forma exclusiva en el almacenamiento local del navegador del usuario.
* **Vídeos e Imágenes**: El acceso a archivos locales se realiza exclusivamente mediante la API del sistema de archivos del navegador (File System Access API) o mediante reproducción local a solicitud y bajo el control del propio usuario.
* **Capturas de pantalla**: Las capturas se procesan de forma inmediata en el navegador y se guardan únicamente donde el usuario decida en su disco local. No se envían a ningún servidor externo.

## 3. Transmisión a Terceros
No existen servidores externos ni servicios en la nube vinculados a estas extensiones. Por lo tanto:
* **Cero transmisión de datos**: Ningún fragmento de información se transmite al desarrollador ni a terceras partes.
* **Sin telemetría ni analíticas**: Las extensiones no incluyen scripts de seguimiento, cookies de terceros ni herramientas de telemetría de uso.

## 4. Control del Usuario
El usuario tiene el control absoluto sobre sus datos. Al desinstalar la extensión o borrar los datos de navegación, toda la información local asociada se eliminará de forma definitiva y permanente de su dispositivo.

---
*Última actualización: Julio de 2026*
