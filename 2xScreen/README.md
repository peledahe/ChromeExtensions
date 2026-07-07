# Mk 2xScreen

Extensión de Chrome (Manifest V3) que simula una pantalla completa de doble ancho sin barras nativas, incorporando una barra de direcciones flotante estilo Minichrome.

## Características principales

- **Pantalla Doble Ancho**: Permite simular áreas de visualización extendidas.
- **Sin Barras Nativas**: Oculta elementos que restan espacio visual en el navegador.
- **Barra de Direcciones Flotante**: Añade controles y navegación estilo Minichrome de forma superpuesta.
- **Compatibilidad**: Compatible con Windows y Linux.

## Instalación Segura y Libre de Permisos

Para garantizar la máxima seguridad y privacidad del usuario (evitando advertencias invasivas de Navegación Segura en Chrome/Edge), la extensión **no requiere permisos de descarga de archivos ni de ejecución en el sistema**. 

El proceso de configuración de la ventana sin bordes se realiza de la siguiente manera:
1. Al pulsar **Configurar en 1 Clic** en la modal de configuración, la extensión genera localmente el configurador nativo (`install_2xscreen.sh` en Linux o `install_2xscreen.bat` en Windows) y lo descarga de forma segura usando mecanismos estándar de HTML5.
2. El usuario hace clic en el archivo descargado para activar la integración con el gestor de ventanas del sistema operativo.
3. La interfaz de la extensión valida en tiempo real y de forma automática la activación (mostrando los pasos completados visualmente con indicadores de estado de color), sin interrumpir la navegación.

## Justificación de Permisos (para Tiendas de Chrome y Edge)

Al publicar la extensión en la **Chrome Web Store** o **Microsoft Edge Add-ons**, se deben justificar los siguientes permisos debido a las políticas de seguridad de datos:

### Permisos (`permissions`)

1. **`system.display`**:
   * *Justificación*: Se requiere para obtener información sobre la resolución y la disposición de las pantallas conectadas. Esto permite calcular con total precisión la geometría de doble monitor en configuraciones de pantalla múltiple.
2. **`storage`**:
   * *Justificación*: Se utiliza para guardar de manera persistente las preferencias del usuario, como el estado plegado/desplegado de la barra de direcciones flotante y la preferencia de silenciar avisos de configuración.
3. **`windows`**:
   * *Justificación*: Es necesario para crear la ventana de tipo 'popup' de doble pantalla, controlar sus dimensiones geométricas, enfocarla y restaurarla a una ventana estándar de navegación.
4. **`tabs`**:
   * *Justificación*: Permite mover la pestaña activa hacia la ventana popup de doble monitor, recargar la página para limpiar la interfaz y controlar la navegación (atrás, adelante, recarga) desde la barra flotante.
5. **`bookmarks`**:
   * *Justificación*: Se requiere para permitir al usuario guardar, consultar y eliminar páginas de sus marcadores/favoritos directamente desde el botón de la estrella en la barra de URL flotante.
6. **`scripting`**:
   * *Justificación*: Permite inyectar de manera temporal una etiqueta de título única en el documento para que el host nativo identifique inequívocamente la ventana a desdecorar en el sistema operativo.
7. **`nativeMessaging`**:
   * *Justificación*: Permite la comunicación bidireccional con el script helper de Python (`com.merke.twoxscreen`) que aplica los cambios en los estilos del gestor de ventanas del sistema operativo para ocultar la barra de título.
8. **`management`**:
   * *Justificación*: Se utiliza para verificar si las extensiones del ecosistema "Mk" (organizador, reproductores, etc.) están instaladas y activas, mostrando u ocultando de forma condicional sus accesos directos en la barra flotante.
### Permisos de Host (`host_permissions`)

* **`<all_urls>`**:
  * *Justificación*: Se requiere para poder inyectar la barra de direcciones flotante superpuesta (content scripts) en cualquier página que el usuario decida navegar cuando esté activa la pantalla doble, proporcionando una interfaz de navegación de reemplazo completa.

