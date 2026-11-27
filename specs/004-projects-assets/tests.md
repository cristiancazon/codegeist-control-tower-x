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

### Evidencia local del 25 de noviembre de 2026

`npm run check` aprobó 71 pruebas, ESLint, TypeScript y el build con Node.js 22.23.4. Las pruebas de operaciones usan el fixture Patagonia persistido y comprueban las consultas con una adaptación de dialecto para SQLite.

| Caso | Resultado observado |
| --- | --- |
| CT004-01 | Paginación, filtros y separación entre el vencimiento Jira y las fechas del plan. Los mapeos revocados y los extremos no visibles de una dependencia se omiten. Un proyecto ajeno en el payload se rechaza antes de leer las fuentes. |
| CT004-02 | Cuatro páginas de 20 activos. A-17 identifica la recepción, el equipo, los paquetes y el proveedor visibles. S2 se lee del escenario publicado y se identifica como hipótesis. Las pruebas distinguen demora prevista, compromiso vencido y entrega tardía. |
| CT004-03 | HSE exige los dos permisos antes de consultar incidentes. El resumen y el detalle omiten referencias externas. Los costes vinculados a trabajo oculto se excluyen del total visible. Los documentos A-17 requieren acceso a sus referencias Jira. |
| CT004-04 | Se probó una fuente sin datos y una fuente indisponible por límite de Jira. Una revocación surte efecto en la siguiente consulta. Las respuestas y logs omiten títulos protegidos, IDs de cuenta y códigos de incidentes. |

En Edge con el bridge de Forge simulado, se comprobó navegación por teclado, foco al abrir y cerrar detalle, paginación y filtros a 1360 y 375 px. El recorrido A-17 a EQ-017 preservó los enlaces. A 375 px se pudo desplazar la tabla sin desbordar la página. HSE denegado ocultó registros y conteos.

### Evidencia en Jira development del 25 de noviembre de 2026

Forge 3.4.0 en PED con el fixture Patagonia y la cuenta de administración de la aplicación, sin el rol adicional HSE.

| Caso | Resultado observado |
| --- | --- |
| CT004-01 | Proyectos mostró seis páginas de paquetes. WP-064 mostró WP-048 como predecesor y WP-083 como sucesor, ambos con relación FS y desfase de cero días. Se pudo volver al listado. Queda comparar con otra cuenta de acceso restringido. |
| CT004-02 | Las cuatro páginas del inventario terminaron en EQ-020, EQ-040, EQ-060 y EQ-080. Overview abrió A-17 en Logística. Desde allí se abrió EQ-017, con mantenimiento y ventana registrada, y el montaje WP-064. El envío mostró riesgo por ETA, el vínculo de CON-03 y la hipótesis S2 de CON-08. Operaciones mostró ocho instalaciones y Contratistas 15 registros. Assets mostró el conector sin habilitar junto al catálogo sintético. |
| CT004-03 | HSE denegó el acceso sin mostrar filas ni conteos. Finanzas mostró USD 30.000.000,00 devengados, con remanente separado. Conocimiento mostró 12 referencias sintéticas. A17-AVISO abrió su ficha con versión y enlace PED-48. Confluence figuró sin habilitar. Queda la prueba positiva con una cuenta `HSE_READER`. |
| CT004-04 | Buscar un código inexistente devolvió «Sin resultados» y mantuvo el estado independiente de Assets «Sin habilitar». Los errores de fuente y la revocación se reprodujeron localmente. |
