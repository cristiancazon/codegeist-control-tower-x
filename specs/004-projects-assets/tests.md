# SDD-004 · Proyectos, activos y operaciones · pruebas

## Preparación

Probar DTO de resúmenes, filtrado, paginación, fecha, fuentes parciales y denegaciones. Consultar Jira como usuarios de distintos perfiles. Activar otras fuentes únicamente cuando sus accesos estén validados.

## Casos

### CT004-01

**Proyecto y dependencias / AC004-01.** Forge development. Comparar dos perfiles con permisos Jira distintos y una fase que incluya referencias ocultas.

### CT004-02

**Recursos y proveedores / AC004-02.** Contrato y sitio de prueba. Ejecutar con datos de demo y con Assets habilitado si es elegible. Probar paginación, 403 y registros inexistentes.

### CT004-03

**HSE, costes y conocimiento / AC004-03.** Unidad y development. Repetir como VIEWER, HSE_READER autorizado y usuario sin proyecto. Verificar totales y referencias.

### CT004-04

**Fallos de origen / AC004-04.** Integración Forge. Simular 429, 5xx, integración desconectada y permiso revocado. Confirmar ausencia de filtración.

## Registro

Por cada caso guardar versión, fecha, entorno, fixture o comandos, resultado esperado y observado, y vínculo a evidencia. Evitar material sensible en capturas y logs. [Aceptación](acceptance.md) · [Plantilla de prueba](../../docs/templates/TEST.md).
