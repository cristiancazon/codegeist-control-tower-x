# SDD-009 · Decisiones y acción correctiva

## Resultado

Transformar la recomendación asociada a A-17 en una acción correctiva Jira después de una aprobación humana trazable.

## Requisitos

- **R009-01 · Propuesta vinculada**. PLANNER crea una propuesta con evidencia vigente, escenario, explicación, acción y destino validado.

- **R009-02 · Aprobación humana**. Una persona APPROVER elegible, distinta del solicitante, puede aceptar o rechazar el alcance mostrado.

- **R009-03 · Escritura Jira confirmada**. El proponente PLANNER solicita explícitamente la ejecución de su propuesta ya aprobada por una cuenta distinta. La identidad Jira es la del proponente y la operación lleva una clave de correlación.

- **R009-04 · Reconciliación y auditoría**. Una respuesta perdida o concurrente no duplica incidencia y expone estado seguro.

## Límites del incremento

- El servidor toma actor, autorización, objetivo y destino de fuentes confiables.
- La ejecución pertenece a UI y la llamada Jira usa `asUser` tras volver a verificar permisos.

## Fuente y navegación

[Plan maestro](../../CONTROL_TOWER_X_MASTER_PLAN.md), §§2, 4–6, 8–9, 12 y 13. [Diseño](plan.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md) · [Pruebas](tests.md).
