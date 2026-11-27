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

`npm run check` pasó en Node.js 22.23.4 con 155 pruebas, incluidas nueve de Decisiones y Jira correctivo. TypeScript, ESLint y build pasaron. Forge CLI 16.0.0 desplegó **3.13.0** en `development` para el registro inicial y **3.14.0** para el ensayo con cuentas distintas. Las pruebas de servicio ejercitaron las sentencias de transición con SQLite y sustituciones acotadas de sintaxis. Las pruebas de transporte simularon respuestas Jira. Los horarios indican la hora de Buenos Aires.

| Caso | Resultado observado | Pendiente en Jira |
| --- | --- | --- |
| CT009-01 | En PED se comprobó el tipo Tarea `10207`, se migró el esquema y se registró una propuesta A-17 como `PLANNER` a las 01:09. La ruta directa conservó propuesta y actividad. La corrida `0c958a1a-ab53-40da-afb2-a15a8fc67141` de S2 mostró P80 de 30 días y USD 46.177.500, con anclaje PED-48. En Forge **3.14.0**, una cuenta con acceso a Jira y sin rol de la app abrió PED-48. La ruta directa de Decisiones y la vista Futuros le denegaron el acceso. Los casos locales bloquearon referencias cruzadas y detectaron conflictos de idempotencia. | — |
| CT009-02 | Una cuenta distinta con `APPROVER` revisó y aprobó la revisión 1 a las 02:01. Su sesión mostró **Aprobada** y la auditoría registró la acción. El control de creación apareció en la sesión del proponente. Los casos locales cubrieron autoaprobación, revisión alterada, dos aprobaciones simultáneas, rechazo y vencimiento. La aprobación produjo cero llamadas de creación en el transporte simulado. | Variantes de concurrencia y vencimiento en Jira real. |
| CT009-03 | El proponente `PLANNER` confirmó por separado la creación en PED a las 02:03. Jira creó **PED-121** con el texto de la revisión, referencias a A-17 y S2 y la etiqueta de correlación. Al reabrir, la app conservó el enlace y la auditoría. Dos peticiones simultáneas produjeron una sola llamada de creación en local. El transporte simulado rechazó permiso revocado y el servicio bloqueó la ejecución por otro actor. | Revocación de `Create Issues` y variantes concurrentes en Jira real. |
| CT009-04 | La búsqueda Jira del marcador exacto `ctx-decision-56bfd7fe-87b0-49ba-846b-06543a297d7c` devolvió **1 de 1** coincidencias visibles para el proponente, identificada como PED-121. La pérdida de respuesta, el bloqueo de reenvío, la búsqueda vacía y la conciliación exacta pasaron con el transporte simulado. | Pérdida de respuesta inducida y conciliación en Jira real. |

[Propuesta sintética y auditoría en PED development](https://one-atlas-wjzw.atlassian.net/jira/software/projects/PED/apps/262d9dea-7d8b-4b70-ab88-f868960c2e09/bde0a6c9-8bb3-4f6c-9440-ac46a5f66b2b/decisiones/56bfd7fe-87b0-49ba-846b-06543a297d7c) · [Incidencia PED-121](https://one-atlas-wjzw.atlassian.net/browse/PED-121) · [Búsqueda Jira por marcador](https://one-atlas-wjzw.atlassian.net/issues/?jql=labels%20%3D%20%22ctx-decision-56bfd7fe-87b0-49ba-846b-06543a297d7c%22).
