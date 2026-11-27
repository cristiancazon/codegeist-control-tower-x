# SDD-009 · Decisiones y acción correctiva · tareas

Cada tarea entrega código y evidencia en la etapa de implementación. Mantener las tareas pendientes hasta demostrar los criterios.

### T009-01 · Propuesta vinculada

- Dependencia. Dependencias declaradas del spec.
- Entrega. Implementar detalle, alta de propuesta y trazabilidad del snapshot y evidencia.
- Verificación. Ejecutar [CT009-01](tests.md#ct009-01) y guardar evidencia de [AC009-01](acceptance.md#ac009-01).
- Estado. Verificada en local y en PED development. La propuesta persistió tras recargar. Jira autorizó una cuenta para leer PED-48 y la app denegó el acceso a la propuesta para esa cuenta sin rol.

### T009-02 · Aprobación humana

- Dependencia. Revisar salida de `T009-01`.
- Entrega. Implementar página de revisión, aprobación, rechazo y tratamiento de aprobación vencida.
- Verificación. Ejecutar [CT009-02](tests.md#ct009-02) y guardar evidencia de [AC009-02](acceptance.md#ac009-02).
- Estado. Aprobación humana por una cuenta `APPROVER` distinta verificada en PED development. Las variantes de concurrencia y vencimiento tienen evidencia local.

### T009-03 · Escritura Jira confirmada

- Dependencia. Revisar salida de `T009-02`.
- Entrega. Crear control explícito de ejecución para el proponente PLANNER, guarda condicional de reserva y adaptador Jira con datos mínimos permitidos y estados de resultado.
- Verificación. Ejecutar [CT009-03](tests.md#ct009-03) y guardar evidencia de [AC009-03](acceptance.md#ac009-03).
- Estado. Creación explícita de PED-121 por el proponente `PLANNER` verificada en PED development. En staging, dos confirmaciones concurrentes reservaron una sola creación. La revocación real de `Create Issues` requiere un espacio Jira que permita retirarlo a una sola cuenta de ensayo.

### T009-04 · Reconciliación y auditoría

- Dependencia. Revisar salida de `T009-03`.
- Entrega. Implementar flujo de auditoría y reconciliación sin reenvío ciego.
- Verificación. Ejecutar [CT009-04](tests.md#ct009-04) y guardar evidencia de [AC009-04](acceptance.md#ac009-04).
- Estado. Verificada en local y en Forge staging con Jira real. El ensayo descartó la confirmación de creación, recuperó PED-122 por el marcador exacto y conservó una sola incidencia con auditoría de conciliación.

[Plan](plan.md) · [Plantilla de tarea](../../docs/templates/TASK.md).
