# SDD-009 · Decisiones y acción correctiva · tareas

Cada tarea entrega código y evidencia en la etapa de implementación. Mantener las tareas pendientes hasta demostrar los criterios.

### T009-01 · Propuesta vinculada

- Dependencia. Dependencias declaradas del spec.
- Entrega. Implementar detalle, alta de propuesta y trazabilidad del snapshot y evidencia.
- Verificación. Ejecutar [CT009-01](tests.md#ct009-01) y guardar evidencia de [AC009-01](acceptance.md#ac009-01).
- Estado. Verificada en local y PED development. La propuesta persistió tras recargar su ruta directa.

### T009-02 · Aprobación humana

- Dependencia. Revisar salida de `T009-01`.
- Entrega. Implementar página de revisión, aprobación, rechazo y tratamiento de aprobación vencida.
- Verificación. Ejecutar [CT009-02](tests.md#ct009-02) y guardar evidencia de [AC009-02](acceptance.md#ac009-02).
- Estado. Implementada y verificada localmente con dos actores simulados. La aprobación humana en Jira requiere la cuenta `APPROVER` autorizada.

### T009-03 · Escritura Jira confirmada

- Dependencia. Revisar salida de `T009-02`.
- Entrega. Crear control explícito de ejecución para el proponente PLANNER, guarda condicional de reserva y adaptador Jira con datos mínimos permitidos y estados de resultado.
- Verificación. Ejecutar [CT009-03](tests.md#ct009-03) y guardar evidencia de [AC009-03](acceptance.md#ac009-03).
- Estado. Implementada y verificada con transporte Jira simulado. La creación real requiere la ejecución explícita del proponente tras una aprobación válida en Jira.

### T009-04 · Reconciliación y auditoría

- Dependencia. Revisar salida de `T009-03`.
- Entrega. Implementar flujo de auditoría y reconciliación sin reenvío ciego.
- Verificación. Ejecutar [CT009-04](tests.md#ct009-04) y guardar evidencia de [AC009-04](acceptance.md#ac009-04).
- Estado. Implementada. La pérdida de respuesta, la concurrencia y la conciliación exacta pasaron en local. Sigue pendiente una corrida controlada con dos personas en Jira.

[Plan](plan.md) · [Plantilla de tarea](../../docs/templates/TASK.md).
