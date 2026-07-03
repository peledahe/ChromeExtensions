# Mk VideoPlayer (VideoPlayer)

Extensión de Chrome (Manifest V3) diseñada para organizar, etiquetar y reproducir tus videos almacenados localmente y desde servidores en la nube en formatos modernos.

## Características principales

- **Reproducción Local Segura**: Abre directorios locales con la File System Access API y reproduce los archivos multimedia directamente en el navegador mediante Object URLs temporales, garantizando la privacidad y sin dejar rastro en el historial de navegación de Chrome.
- **Soporte HLS e Híbrido**: Integra la librería `hls.js` para reproducir contenidos vía streaming (.m3u8) y es compatible con formatos locales clásicos (.mp4, .webm, .mkv, entre otros).
- **Listas de Reproducción y Etiquetas**: Crea playlists en la nube y asocia etiquetas a tus videos locales para facilitar su ordenación.
- **Historial Local**: Recuerda de manera privada el progreso de reproducción de tus videos.
- **Compatibilidad**: Compatible con Windows y Linux. Si la extensión es ejecutada en sistemas sin soporte de File System Access API (como iOS), el módulo de exploración local se desactiva de forma elegante.
