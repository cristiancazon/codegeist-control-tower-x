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
