# SDD-004 · Proyectos, activos y operaciones · tareas

Cada tarea entrega código y evidencia en la etapa de implementación. Mantener las tareas pendientes hasta demostrar los criterios.

### T004-01 · Proyecto y dependencias

- Dependencia. Dependencias declaradas del spec.
- Entrega. Implementar listado paginado y detalle con filtros de fase, atraso y vínculos autorizados.
- Verificación. Ejecutar [CT004-01](tests.md#ct004-01) y guardar evidencia de [AC004-01](acceptance.md#ac004-01).
- Estado. Verificado en Jira PED y por contrato. Queda el ensayo con otra cuenta restringida.

### T004-02 · Recursos y proveedores

- Dependencia. Revisar salida de `T004-01`.
- Entrega. Añadir vistas resumidas y trazabilidad de alquiler y demora desde A-17.
- Verificación. Ejecutar [CT004-02](tests.md#ct004-02) y guardar evidencia de [AC004-02](acceptance.md#ac004-02).
- Estado. Verificados inventario, paginación y recorrido A-17 en development. Queda la prueba del conector Assets cuando se autorice su configuración.

### T004-03 · HSE, costes y conocimiento

- Dependencia. Revisar salida de `T004-02`.
- Entrega. Agregar vistas compactas y límites de detalle por rol para HSE, Financial y Knowledge.
- Verificación. Ejecutar [CT004-03](tests.md#ct004-03) y guardar evidencia de [AC004-03](acceptance.md#ac004-03).
- Estado. Verificados los resúmenes sintéticos y la denegación HSE en development. Queda el ensayo positivo con `HSE_READER` en Jira.

### T004-04 · Fallos de origen

- Dependencia. Revisar salida de `T004-03`.
- Entrega. Habilitar pruebas de degradación y registro de advertencias por fuente.
- Verificación. Ejecutar [CT004-04](tests.md#ct004-04) y guardar evidencia de [AC004-04](acceptance.md#ac004-04).
- Estado. Verificados el estado vacío y el conector sin habilitar en Jira. Los fallos y la revocación se probaron localmente.

[Plan](plan.md) · [Plantilla de tarea](../../docs/templates/TASK.md).
