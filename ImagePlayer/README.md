# Mk Visor de Imágenes (ImagePlayer)

Extensión de Chrome (Manifest V3) diseñada para visualizar y organizar tus carpetas de imágenes locales de forma ágil utilizando la File System Access API de la Web.

---

## 🚀 Ficha de Publicación para Chrome Web Store

### 🏷️ Datos Básicos
- **Nombre de la Extensión:** Mk Visor de Imágenes
- **Versión:** 1.1 (Versión Actualizada)
- **Descripción Corta (Máx. 150 caracteres):** Visualiza y organiza tus carpetas de imágenes locales rápidamente usando la File System Access API. Totalmente local y sin conexión a internet.
- **Categoría:** Productividad / Herramientas de desarrollo
- **Idioma principal:** Español (es)

### 📝 Descripción Detallada (Larga)
**Mk Visor de Imágenes** es un visualizador y organizador de archivos multimedia ligero y veloz, diseñado con un enfoque 100% local y de privacidad absoluta (*local-first*). Abre una interfaz en pantalla completa para explorar tus fotos e ilustraciones sin depender de servicios externos ni comprometer el ancho de banda.

#### Características principales:
1. 📂 **Acceso a Carpetas Locales:** Utiliza la API nativa de acceso a archivos (`showDirectoryPicker`) para indexar y navegar por carpetas del disco local del usuario.
2. 🖼️ **Visor Interactivo y Lightbox:** Incluye controles avanzados de presentación, zoom, arrastre libre (pan) y navegación fluida por teclado o mouse.
3. ✏️ **Gestión de Archivos Directa:** Permite renombrar, mover y eliminar archivos de imagen directamente dentro del directorio seleccionado de forma segura.
4. ⚙️ **Compatibilidad Controlada:** Totalmente compatible con Windows y Linux. En dispositivos sin soporte a la API de archivos (como iOS), la extensión deshabilita la exploración local mostrando un aviso informativo de compatibilidad.

---

## 🔒 Declaración de Privacidad y Uso de Datos (Developer Dashboard)

*Información para completar el formulario de revisión y justificaciones de la Chrome Web Store:*

- **Permisos de Manifiesto (`permissions`):** Ninguno. La extensión no declara ningún permiso en su archivo `manifest.json`.
- **Acceso a Datos Locales:** La extensión accede a directorios locales elegidos explícitamente por el usuario utilizando la API de acceso al sistema de archivos del navegador (`File System Access API`). Cada acceso requiere la autorización explícita del usuario a través del cuadro de diálogo nativo del navegador.
- **Privacidad de los Archivos:** Todo el procesamiento de imágenes (carga en pantalla, lectura de metadatos, renombrado, organización y borrado) se realiza en el hilo del cliente (local-only). Ningún archivo, metadato o información de navegación es recopilado, guardado o transmitido a servidores remotos.

---

## 🛠️ Instalación en Modo de Desarrollo
1. Descarga o clona este repositorio.
2. Abre Google Chrome y navega a `chrome://extensions/`.
3. Activa el **Modo de desarrollador** (esquina superior derecha).
4. Haz clic en **Cargar descomprimida** y selecciona la carpeta de esta extensión.
