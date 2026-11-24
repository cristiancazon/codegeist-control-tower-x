# SDD-009 · Decisiones y acción correctiva · plan técnico

## Dependencias

SDD-006 y SDD-007. Proyecto Jira dedicado, tipos y campos validados, y cuentas solicitante y aprobadora distintas con roles y ACL definidos.

## Capas y decisiones

### R009-01 · Propuesta vinculada

Validar referencias de Futuros y scope Jira. Congelar contenido aprobado y permitir ediciones materiales solo por revisión o nueva aprobación.

### R009-02 · Aprobación humana

Verificar estado, expiración, segregación, hash material y rol, con mutación condicional y auditoría.

### R009-03 · Escritura Jira confirmada

Comprobar que el solicitante de ejecución es el proponente PLANNER, que la aprobación de otro actor está vigente para esa revisión y que los permisos Jira del proponente siguen vigentes. Reservar `EXECUTING` con actualización condicional por estado, revisión y expiración. Usar `asUser()` y el endpoint Create Issue según §4.4. Guardar resultado y enlace conciliados.

### R009-04 · Reconciliación y auditoría

Reivindicar ejecución con guardas. Clasificar rechazo definitivo y resultado remoto incierto. Buscar evidencia por correlación con el permiso adecuado antes de autorizar otro intento.

## Evidencia por entorno

- Local. Probar transiciones, guardas, idempotencia, permisos, cambios postaprobación, entrega incierta y reconciliación con adaptador.
- Entorno real. Validar dos identidades reales en Forge y la incidencia en Jira. Probar perfil sin permiso Create Issues y segundo intento.

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
