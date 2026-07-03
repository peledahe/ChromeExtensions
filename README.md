# Extensiones de Chrome — Colección Multiplataforma

Este repositorio contiene un conjunto de extensiones de navegador desarrolladas bajo el estándar de **Manifest V3** de Chrome. Están optimizadas para ofrecer una experiencia fluida en sistemas operativos de escritorio (Windows y Linux) e integrarse con el entorno de Minichrome.

## Listado de Extensiones

A continuación se detalla la colección de extensiones incluidas:

1. [**Mk Visor de Imágenes (ImagePlayer)**](file:///home/perry/Desarrollo/ChromeExtensions/ImagePlayer/README.md)
   Organizador y visualizador rápido de directorios de imágenes locales mediante la *File System Access API* de la Web, con herramientas de edición básica (renombrar, mover y borrar) y soporte para cambiar el fondo de pantalla en Linux.

2. [**Mk VideoPlayer (VideoPlayer)**](file:///home/perry/Desarrollo/ChromeExtensions/VideoPlayer/README.md)
   Reproductor multimedia interactivo de archivos de video locales (a través de Object URLs en memoria) y transmisiones de streaming (.m3u8), con soporte para playlists, asignación de etiquetas y registro de progreso de reproducción privada.

3. [**Mk Agenda & Notas (Notes)**](file:///home/perry/Desarrollo/ChromeExtensions/Notes/README.md)
   Herramienta completa de productividad que gestiona una agenda personal, listas de compras, contabilidad simple de ingresos, tableros Kanban, notas de texto enriquecido y almacenamiento seguro de contraseñas.

4. [**Mk ScreenShot (screenshot)**](file:///home/perry/Desarrollo/ChromeExtensions/screenshot/README.md)
   Utilidad de captura de pantalla interactiva que proporciona un editor en lienzo (canvas) para añadir flechas, figuras, notas de texto, numeración de pasos y difuminado (blur) antes de descargar o copiar al portapapeles.

5. [**Mk 2xScreen (2xScreen)**](file:///home/perry/Desarrollo/ChromeExtensions/2xScreen/README.md)
   Simulador de una pantalla de doble ancho sin bordes de ventana ni barras nativas, diseñado para optimizar el área de visualización en el escritorio web incorporando una barra flotante Minichrome.

---

## Compatibilidad Multiplataforma

- **Windows y Linux**: Compatibilidad completa. El procesamiento de rutas locales nativas en los módulos de comunicación se normaliza automáticamente utilizando los separadores correspondientes (`\` para Windows y `/` para Linux).
- **iOS/móviles**: Las extensiones que hacen uso de la *File System Access API* (`ImagePlayer` y `VideoPlayer`) detectan de forma preventiva la disponibilidad de estas funciones nativas. En entornos donde no está soportado (como iOS), deshabilitan las opciones locales con gracia mostrando avisos de compatibilidad en lugar de generar errores.
