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

## Perfil de demostración

El resolver toma el proyecto y la cuenta de Forge. El destino se limita al sitio y proyecto Jira configurados en `CTX_DEMO_CLOUD_ID` y `CTX_DEMO_JIRA_PROJECT_ID` para development. `CTX_DECISIONS_ISSUE_TYPE_ID` selecciona el tipo Tarea validado en la metadata de creación. La propuesta admite S2 publicado del snapshot Patagonia vigente, la referencia Jira actual de WP-048 y texto escrito por el proponente. La huella protege revisión, contenido y destino. Las migraciones aditivas de Forge SQL conservan los datos de los incrementos previos. [Creación Jira](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post) · [Búsqueda Jira](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/).

En la jornada de prueba, un operador autorizado configura en `CTX_DEMO_APPROVER_ACCOUNT_ID` el identificador de la cuenta revisora distinta con acceso Jira a la evidencia de PED. Tras desplegar la variable, esa persona abre **Decisiones** y confirma **Activar revisión para mi cuenta**. La activación comprueba el sitio, proyecto y evidencia y concede `APPROVER` y `VIEWER` en PED. Los roles revocados conservan su estado. El proponente abre la bandeja, revisa la aprobación y elige **Preparar creación en Jira**. La acción final es **Confirmar creación de incidencia**. La cuenta revisora conserva acceso a la propuesta y a su actividad.

Una reserva dura 90 segundos antes de quedar disponible para conciliación. `GET /rest/api/3/search/jql` busca el marcador exacto en el proyecto. La confirmación exige una única coincidencia con lectura directa y comparación de tipo, título, descripción ADF y marcador. Cero, varias o una coincidencia incompleta mantienen la conciliación abierta. Los eventos de auditoría usan identificadores estables y la fila conserva revisión, motivo y autorización originales. [SQL de Forge](https://developer.atlassian.com/platform/forge/storage-reference/sql/).

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
