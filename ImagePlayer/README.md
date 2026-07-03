# Mk Visor de Imágenes (ImagePlayer)

Extensión de Chrome (Manifest V3) diseñada para visualizar y organizar tus carpetas de imágenes locales de forma ágil utilizando la File System Access API de la Web.

## Características principales

- **Acceso a Carpetas Locales**: Utiliza `showDirectoryPicker` para indexar imágenes del disco local sin cargarlas a internet.
- **Transición y Lightbox**: Visor de imágenes integrado con opciones de zoom, desplazamiento libre (pan) y descarga rápida.
- **Gestión Básica de Archivos**: Permite renombrar, mover y eliminar imágenes de forma directa en el sistema de archivos.
- **Fondo de Pantalla interactivo**: Opción de establecer una imagen como fondo de pantalla del sistema (requiere puente con Minichrome en Linux).
- **Compatibilidad**: Compatible con Windows y Linux. En dispositivos móviles o navegadores sin soporte de la File System API (como iOS), se deshabilita la exploración local de manera controlada.
