# SDD-003 · Overview · plan técnico

## Dependencias

SDD-002 con fixtures y política de permisos. Contratos de servicios documentados.

## Capas y decisiones

### R003-01 · Contrato de Overview

El resolver usa datos de servidor autorizados y estado de fuente. Los indicadores comparten snapshot cuando representan la misma fecha.

### R003-02 · Dashboard y visualización

Usar componentes consistentes con la interfaz de Jira, formatos es-AR y datos textuales equivalentes.

### R003-03 · Navegación A-17

Resolver asociaciones mediante IDs y rutas de la instalación. Validar usuario en cada frontera y usar links Atlassian controlados.

### R003-04 · Medición y regresión

Instrumentar duración, disponibilidad y origen por operación, con correlación y sin datos confidenciales.

## Evidencia por entorno

- Local. Cargar vistas con estado completo, parcial, vacío y denegado. Ejecutar pruebas de accesibilidad con fixtures.
- Entorno real. Abrir Overview en la instalación con seed, medir latencia y validar vínculos reales de Jira.

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
