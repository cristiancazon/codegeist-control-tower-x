# SDD-004 · Proyectos, activos y operaciones · plan técnico

## Dependencias

SDD-002 y contrato de fuentes. Para lectores opcionales comprobar las capacidades del sitio antes de conectarlos.

## Capas y decisiones

### R004-01 · Proyecto y dependencias

Preservar identidad estable de las issues y leer el origen con permisos del actor. Usar modelo de dependencias del plan para relaciones calculadas.

### R004-02 · Recursos y proveedores

Unificar DTO con fuente, fecha de corte, calidad y disponibilidad. Una integración deshabilitada conserva el estado de demo según §2 y §3.

### R004-03 · HSE, costes y conocimiento

Control de clearance HSE, monedas declaradas y procedencia. Los usuarios no autorizados tampoco reciben filtraciones mediante aggregates o enlaces.

### R004-04 · Fallos de origen

Mapear estados de fuente y comprobar ACL nuevamente al acceder a un detalle. Acotar reintentos e invalidar caché aplicable.

## Evidencia por entorno

- Local. Probar DTO de resúmenes, filtrado, paginación, fecha, fuentes parciales y denegaciones.
- Entorno real. Consultar Jira como usuarios de distintos perfiles. Activar otras fuentes únicamente cuando sus accesos estén validados.

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
