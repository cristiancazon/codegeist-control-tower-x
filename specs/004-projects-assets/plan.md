# SDD-004 · Proyectos, activos y operaciones · plan técnico

## Dependencias

SDD-002 y contrato de fuentes. Para lectores opcionales comprobar las capacidades del sitio antes de conectarlos.

## Capas y decisiones

### R004-01 · Proyecto y dependencias

Cruzar el identificador estable de Jira con el mapeo vigente de Forge SQL. Aplicar filtros y paginación de a 20 sobre las filas visibles. Volver a verificar visibilidad en cada detalle y omitir las aristas con un extremo inaccesible. [API de búsqueda Jira](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/).

### R004-02 · Recursos y proveedores

Mostrar la procedencia y el corte del snapshot para equipos, proveedores y envíos sintéticos. Adjuntar trabajo y recepciones solo tras la lectura común de Jira. Indicar «Sin habilitar» para el conector Assets hasta validar el workspace y el acceso a los objetos. [API de Assets](https://developer.atlassian.com/cloud/assets/rest/api-group-object/).

### R004-03 · HSE, costes y conocimiento

Exigir rol de proyecto más `HSE_READER` antes de consultar incidentes. Mantener enteros en centavos y separar devengado, base remanente y tarifas. El catálogo de conocimiento sintético exige el fixture publicado y los permisos de sus referencias Jira. JSM y Confluence requieren autorización propia para conectar contenido real. [API de solicitudes de JSM](https://developer.atlassian.com/cloud/jira/service-desk/rest/api-group-request/) · [API de páginas de Confluence](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/).

### R004-04 · Fallos de origen

Mostrar fuente parcial, no disponible o sin habilitar y distinguirla de un listado vacío. Revalidar cuentas, roles y visibilidad en cada activación de lista o detalle. Los logs registran códigos de fuente, identificador de soporte y duración.

## Evidencia por entorno

- Local. Probar DTO de resúmenes, filtrado, paginación, fecha, fuentes parciales y denegaciones.
- Entorno real. Consultar Jira como usuarios de distintos perfiles. Activar otras fuentes únicamente cuando sus accesos estén validados.

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
