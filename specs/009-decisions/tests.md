# SDD-009 · Decisiones y acción correctiva · pruebas

## Preparación

Probar transiciones, guardas, idempotencia, permisos, cambios postaprobación, entrega incierta y reconciliación con adaptador. Validar dos identidades reales en Forge y la incidencia en Jira. Probar perfil sin permiso Create Issues y segundo intento.

## Casos

### CT009-01

**Propuesta vinculada / AC009-01.** Unidad y Forge development. Crear recomendación de S2 y alterar corrida, versión y destino en payload. Comparar registros y errores.

### CT009-02

**Aprobación humana / AC009-02.** Unidad y development. Intentar autoaprobación, aprobación concurrente, solicitud expirada y modificación material posterior. Verificar que una aprobación válida conserva cero solicitudes Create Issue hasta que el proponente ejecuta.

### CT009-03

**Escritura Jira confirmada / AC009-03.** Forge development y Jira. B (APPROVER) aprueba. A (PLANNER y proponente) ejecuta con permisos vigentes. Intentar otra ejecución como B y repetir el caso con `Create Issues` revocado para A antes de ejecutar. Abrir Jira y contrastar cantidad, atributos y actor de la única creación confirmada.

### CT009-04

**Reconciliación y auditoría / AC009-04.** Integración Forge y Jira. Simular 201 con pérdida de respuesta y dos solicitudes simultáneas. Volver a conciliar y demostrar que Jira conserva una sola incidencia.

## Registro

Por cada caso guardar versión, fecha, entorno, fixture o comandos, resultado esperado y observado, y vínculo a evidencia. Evitar material sensible en capturas y logs. [Aceptación](acceptance.md) · [Plantilla de prueba](../../docs/templates/TEST.md).

### Resultados del 27 de noviembre de 2026

`npm run check` pasó en Node.js 22.23.4 con 155 pruebas, incluidas nueve de Decisiones y Jira correctivo. TypeScript, ESLint y build pasaron. Forge CLI 16.0.0 desplegó **3.13.0** en `development` con los scopes Jira vigentes. Las pruebas de servicio ejercitaron las sentencias de transición con SQLite y sustituciones acotadas de sintaxis. Las pruebas de transporte simularon respuestas Jira.

| Caso | Resultado observado | Pendiente en Jira |
| --- | --- | --- |
| CT009-01 | En PED se comprobó el tipo Tarea `10207`, se migró el esquema y se registró una propuesta A-17 como `PLANNER` a las 01:09, hora de Buenos Aires. Se reabrió la ruta directa y la actividad permaneció visible. La corrida `0c958a1a-ab53-40da-afb2-a15a8fc67141` de S2 mostró P80 de 30 días y USD 46.177.500, con anclaje PED-48. Los casos locales bloquearon referencias cruzadas y detectaron conflictos de idempotencia. | Sesión con acceso restringido para comprobar visibilidad. |
| CT009-02 | Los casos locales cubrieron autoaprobación, revisión alterada, dos aprobaciones simultáneas, rechazo y vencimiento. La aprobación produjo cero llamadas de creación en el transporte simulado. En PED la cuenta proponente vio el estado pendiente y careció de controles de aprobación o creación. | Aprobación de una segunda cuenta real autorizada. |
| CT009-03 | Dos peticiones simultáneas produjeron una sola llamada de creación. El transporte local rechazó permiso revocado y el servicio bloqueó la ejecución por otro actor y la revocación de `APPROVER`. | Ejecución en Jira por el proponente una vez obtenida la aprobación. |
| CT009-04 | Una respuesta perdida dejó conciliación pendiente y bloqueó otro POST. La búsqueda vacía mantuvo la incertidumbre. Una coincidencia exacta visible confirmó la incidencia y creó trazas de auditoría sin otro POST en la simulación. | Ensayo controlado de conciliación y evidencia de Jira. |

[Propuesta sintética en PED development](https://one-atlas-wjzw.atlassian.net/jira/software/projects/PED/apps/262d9dea-7d8b-4b70-ab88-f868960c2e09/bde0a6c9-8bb3-4f6c-9440-ac46a5f66b2b/decisiones/56bfd7fe-87b0-49ba-846b-06543a297d7c).
