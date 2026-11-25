# SDD-003 · Overview · plan técnico

## Dependencias

SDD-002 con fixtures y política de permisos. Contratos de servicios documentados.

## Capas y decisiones

### R003-01 · Contrato de Overview

El resolver usa el proyecto del contexto Forge, confirma `Browse Projects` como usuario activo y exige un rol de Control Tower X para ese proyecto. La lectura de Jira entrega únicamente los ítems visibles para esa cuenta. La fase y la fecha de corte permiten acotar los indicadores sin cambiar de proyecto. Los indicadores sintéticos de estado usan el snapshot sellado autorizado. [Seguridad del contexto Forge](https://developer.atlassian.com/platform/forge/app-context-security/) · [Búsqueda Jira](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/).

### R003-02 · Dashboard y visualización

Usar componentes consistentes con la interfaz de Jira, formatos es-AR y datos textuales equivalentes.

### R003-03 · Navegación A-17

Resolver asociaciones mediante IDs y rutas de la instalación. Volver a verificar permisos al abrir el detalle y mostrar enlaces de Jira con claves que la cuenta puede consultar. El insumo de Futuros queda vinculado al ID del snapshot exacto y al escenario publicado. [Navegación de Forge](https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/router/).

### R003-04 · Medición y regresión

Instrumentar duración, disponibilidad y origen por operación, con correlación y sin datos confidenciales.

## Evidencia por entorno

- Local. Cargar vistas con estado completo, parcial, vacío y denegado. Ejecutar pruebas de accesibilidad con fixtures.
- Entorno real. Abrir Overview en la instalación con seed, medir latencia y validar vínculos reales de Jira.

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
