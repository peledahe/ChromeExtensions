# Mk Organizer

Extensión de Chrome (Manifest V3) que unifica tu productividad personal en un solo lugar: agenda de tareas, presupuesto personal categorizado, planificador de deudas con el método Bola de Nieve, tablero Kanban, pizarra de notas rápidas y gestor seguro de contraseñas.

---

## 🚀 Ficha de Publicación para Chrome Web Store / Play Store

*Esta sección contiene la información oficial requerida para subir y registrar la extensión en las tiendas de aplicaciones.*

### 🏷️ Datos Básicos
- **Nombre de la Extensión:** Mk Organizer
- **Versión:** 2.0 (Nueva Versión Reestructurada)
- **Descripción Corta (Máx. 150 caracteres):** Tu organizador personal en Chrome: presupuesto unificado, planificador de deudas (Bola de Nieve), tareas Kanban, notas y sincronización opcional con Google Drive.
- **Categoría:** Productividad / Herramientas de desarrollo
- **Idioma principal:** Español (es)

### 📝 Descripción Detallada (Larga)
**Mk Organizer** es la extensión definitiva para organizar tu día a día, tus finanzas y tus metas de forma sencilla, fluida y con privacidad absoluta. Diseñada bajo un enfoque *local-first*, tus datos se guardan de manera segura en tu navegador y te permite realizar sincronización en la nube opcional con tu cuenta personal de Google Drive.

#### Características Destacadas:
1. 💸 **Presupuesto Categorizado e Interactivo (Ejecución):** Olvídate de complicadas hojas de cálculo. Registra tus ingresos y gastos mensuales por categorías definiendo si están **Proyectados** (pendientes de confirmarse) o **Confirmados** (ejecutados). Esto te permite ver la ejecución de tu mes frente a los límites definidos. Las barras de progreso por categoría muestran secciones duales (sólido para ejecutado real y rayado translúcido para proyección) e integra un botón interactivo de un solo clic para confirmar transacciones proyectadas rápidamente. Soporta visualización de moneda secundaria con etiquetas optimizadas para evitar el bold y facilitar la lectura.
2. 🎯 **Plan de Ahorros por Objetivos (Multi-moneda):** Define tus metas de ahorro a corto, mediano y largo plazo. Agrega metas detallando el monto objetivo, monto acumulado y la cuota mensual. Cuenta con soporte multi-moneda para planificar tanto en moneda local (Q) como secundaria (US$). Podrás registrar aportes directamente desde la vista de ahorros, los cuales se sincronizarán de forma automática con tu presupuesto de gastos bajo la categoría de Ahorros.
3. 📈 **Planificador de Deudas (Método Bola de Nieve):** Toma el control de tu libertad financiera. Ingresa tus deudas, pagos mínimos y asigna un presupuesto mensual. El planificador simulará automáticamente el calendario de amortización, abonando los excedentes de tu presupuesto a la deuda más pequeña y reinvirtiendo el flujo liberado para liquidar el resto en tiempo récord. Realiza abonos manuales que se registran de forma automática en tu presupuesto.
4. 📋 **Tablero Kanban Interactivo:** Organiza tus proyectos y tareas mediante un tablero visual con columnas de estado (Por hacer, En progreso, Bloqueado, Hecho). Arrastra y clasifica tus prioridades fácilmente.
5. 🗓️ **Agenda y Calendario:** Visualiza recordatorios y tareas clave en un calendario dinámico para que nunca se te pase ninguna fecha importante.
6. 📌 **Pizarra de Notas Adhesivas:** Crea notas de texto rápido en un lienzo virtual interactivo para plasmar ideas repentinas.
7. 🔑 **Gestor de Claves Seguro:** Almacena y gestiona tus contraseñas web. La extensión incluye un detector de formularios de inicio de sesión que te sugerirá guardar tus credenciales de forma automática cuando navegues.
8. ☁️ **Sincronización Opcional con Google Drive:** Conecta tu cuenta mediante OAuth 2.0 y sincroniza tus datos en la nube (`mkorganizer_data.json`). Si prefieres no usar la nube, la extensión seguirá funcionando al 100% de manera local.

---

## 🔒 Justificación de Permisos (Declaración de Privacidad)
Al publicar la extensión, Chrome Web Store solicita declarar la necesidad de los siguientes permisos:

- **`storage`:** Requerido para almacenar de manera persistente las tareas, notas, presupuestos, configuraciones y credenciales del usuario de forma local mediante `chrome.storage.local`.
- **`activeTab`:** Necesario únicamente para que el detector de credenciales pueda evaluar y proponer el guardado de contraseñas de forma segura en la página web en la que el usuario decida iniciar sesión activamente.
- **`identity`:** Requerido para conectar opcionalmente con la API de Google Drive mediante el inicio de sesión OAuth 2.0 seguro, permitiendo al usuario respaldar y sincronizar sus datos.
- **Permisos de Host (`http://*/*` y `https://*/*`):** Requeridos para inyectar de forma segura el script detector de credenciales (`content_script.js`) en las páginas web en las que navega el usuario. Esto permite interceptar localmente los envíos de formularios para sugerir y almacenar nuevas claves en el Gestor de Contraseñas local.

---

## 🛠️ Instalación en Modo de Desarrollo
1. Descarga o clona este repositorio en tu estación de trabajo.
2. Abre Google Chrome y navega a `chrome://extensions/`.
3. Activa el **Modo de desarrollador** (esquina superior derecha).
4. Haz clic en **Cargar descomprimida** y selecciona la carpeta que contiene el archivo `manifest.json` de esta extensión.
