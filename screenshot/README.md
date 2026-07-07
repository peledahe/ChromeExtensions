# Mk ScreenShot (screenshot)

Extensión de Chrome (Manifest V3) que permite capturar el área visible de la pestaña del navegador y aplicar anotaciones gráficas de manera rápida e intuitiva.

## Características principales

- **Captura con un clic**: Obtiene una captura instantánea de la pestaña activa mediante `chrome.tabs.captureVisibleTab`.
- **Editor Gráfico Integrado**: Canvas interactivo que incluye herramientas para:
  - Dibujar cuadros, flechas y resaltadores.
  - Numerar pasos automáticamente.
  - Añadir cuadros de texto flotantes.
  - Difuminar o pixelar información sensible (herramienta de blur).
- **Acciones Rápidas**: Copia la captura resultante directamente al portapapeles o descárgala como un archivo de imagen local.
- **Compatibilidad**: Compatible con Windows y Linux.

## Justificación de Permisos (para Tiendas de Chrome y Edge)

Al publicar la extensión en la **Chrome Web Store** o **Microsoft Edge Add-ons**, se deben justificar los siguientes permisos declarados en el manifiesto debido a las políticas de seguridad de datos:

### Permisos (`permissions`)

1. **`activeTab`**:
   * *Justificación*: Se requiere para obtener acceso temporal y seguro a la pestaña activa del usuario tras su interacción explícita (hacer clic en el icono de la extensión). Esto otorga permiso para capturar visualmente el contenido del sitio web actual mediante la API `chrome.tabs.captureVisibleTab` de forma puntual, sin necesidad de solicitar permisos globales permanentes de lectura de datos para todos los sitios web visitados.
2. **`storage`**:
   * *Justificación*: Se utiliza de manera estrictamente local y offline para almacenar temporalmente el historial de capturas recientes del usuario, así como para guardar sus preferencias en el lienzo del editor (como el color del pincel, grosor de las líneas de dibujo y estados de las herramientas de anotación).

## Instrucciones de Empaquetado para la Tienda

Para evitar errores de validación de archivos innecesarios al subir la extensión a las tiendas de extensiones oficiales:
1. Ejecuta el script de empaquetado automático en tu terminal:
   ```bash
   ./package.sh
   ```
2. Esto creará el archivo limpio **`screenshot_upload.zip`** en la raíz del proyecto, el cual excluye imágenes de desarrollo y capturas de prueba, incluyendo exclusivamente los recursos del código de producción de la extensión.
3. Sube directamente el archivo `screenshot_upload.zip` a la consola de desarrollador.
