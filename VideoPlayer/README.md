# Mk VideoPlayer (VideoPlayer)

Extensión de Chrome (Manifest V3) diseñada para organizar, etiquetar y reproducir tus videos almacenados localmente y desde servidores en la nube en formatos modernos.

## Características principales

- **Reproducción Local Segura**: Abre directorios locales con la File System Access API y reproduce los archivos multimedia directamente en el navegador mediante Object URLs temporales, garantizando la privacidad y sin dejar rastro en el historial de navegación de Chrome.
- **Soporte HLS e Híbrido**: Integra la librería `hls.js` para reproducir contenidos vía streaming (.m3u8) y es compatible con formatos locales clásicos (.mp4, .webm, .mkv, entre otros).
- **Listas de Reproducción y Etiquetas**: Crea playlists en la nube y asocia etiquetas a tus videos locales para facilitar su ordenación.
- **Historial Local**: Recuerda de manera privada el progreso de reproducción de tus videos.
- **Compatibilidad**: Compatible con Windows y Linux. Si la extensión es ejecutada en sistemas sin soporte de File System Access API (como iOS), el módulo de exploración local se desactiva de forma elegante.

## Justificación de Permisos (para Tiendas de Chrome y Edge)

Esta extensión destaca por su diseño centrado en la seguridad del usuario y su bajo perfil de riesgo tecnológico:

### Permisos Declarados (`permissions`)

* **Ninguno**: La extensión no solicita **ningún permiso declarativo** (como `storage`, `tabs`, `activeTab` o `host_permissions`) en su archivo de manifiesto `manifest.json`.
* **Justificación de Seguridad**: Todos los datos de sesión (historial de reproducción, listas de reproducción locales y configuraciones del tema) se guardan localmente en el navegador del usuario utilizando almacenamiento web estándar de HTML5 (`localStorage` e `IndexedDB`). La reproducción y el acceso a los directorios de archivos locales se ejecutan bajo el consentimiento explícito del usuario mediante la API de acceso al sistema de archivos nativa del navegador (`File System Access API`) y Object URLs temporales, garantizando una privacidad absoluta.

## Instrucciones de Empaquetado para la Tienda

Para evitar subir archivos innecesarios de desarrollo (como capturas de pantalla, archivos de promoción o este README) a la tienda de extensiones:
1. Abre tu terminal en la carpeta de la extensión y ejecuta:
   ```bash
   ./package.sh
   ```
2. Esto creará de forma automatizada el archivo **`videoplayer_upload.zip`** que contiene únicamente los archivos de código necesarios para la extensión.
3. Sube directamente el archivo `videoplayer_upload.zip` a la consola de desarrollador de Google Chrome o de Microsoft Edge.
