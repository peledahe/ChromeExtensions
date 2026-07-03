# Mk Agenda & Notas (Notes)

Extensión de Chrome (Manifest V3) que integra múltiples utilidades de productividad personal, como agenda, lista de compras, finanzas (ingresos), tableros Kanban, notas y gestor de claves. 

## Características principales

- **Módulos Integrados**:
  - *Agenda*: Eventos, recordatorios y tareas organizadas.
  - *Compras*: Listado dinámico para compras periódicas.
  - *Ingresos*: Registro contable personal básico.
  - *Kanban*: Tablero visual para la organización de proyectos.
  - *Notas y Claves*: Notas de texto rápido y resguardo seguro de credenciales.
- **Persistencia Flexible**: Utiliza el motor de almacenamiento de Chrome en su versión web autónoma y un puente (`QWebChannel`) con base de datos SQLite al ser ejecutado mediante el entorno Minichrome.
- **Explorador de Archivos**: Permite configurar directorios para enlazar capturas e imágenes (normalizando rutas dinámicamente en Windows y Linux).
- **Compatibilidad**: Compatible con Windows y Linux.
