# SDD-005 · Motor Futuros · tareas

Cada tarea entrega código y evidencia en la etapa de implementación. Mantener las tareas pendientes hasta demostrar los criterios.

### T005-01 · Snapshot y validador

- Dependencia. Dependencias declaradas del spec.
- Entrega. Implementar normalización, snapshot y validación integral, incluidos errores tipados.
- Verificación. Ejecutar [CT005-01](tests.md#ct005-01) y guardar evidencia de [AC005-01](acceptance.md#ac005-01).
- Estado. Pendiente.

### T005-02 · Modelos base

- Dependencia. Revisar salida de `T005-01`.
- Entrega. Implementar núcleo TypeScript puro, distribución y función agregadora sobre casos deterministas.
- Verificación. Ejecutar [CT005-02](tests.md#ct005-02) y guardar evidencia de [AC005-02](acceptance.md#ac005-02).
- Estado. Pendiente.

### T005-03 · Estadísticos y sensibilidad

- Dependencia. Revisar salida de `T005-02`.
- Entrega. Agregar cálculo y serialización de resultados con sus etiquetas de incertidumbre, supuestos y oráculos.
- Verificación. Ejecutar [CT005-03](tests.md#ct005-03) y guardar evidencia de [AC005-03](acceptance.md#ac005-03).
- Estado. Pendiente.

### T005-04 · Ejecución asíncrona

- Dependencia. Revisar salida de `T005-03`.
- Entrega. Implementar cola, guardas de duplicado y fencing, reconciliación y agregación final.
- Verificación. Ejecutar [CT005-04](tests.md#ct005-04) y guardar evidencia de [AC005-04](acceptance.md#ac005-04).
- Estado. Pendiente.

### T005-05 · Fixture A-17

- Dependencia. Revisar salida de `T005-04`.
- Entrega. Ejecutar las tres corridas y guardar su evidencia de versión, semilla y digest.
- Verificación. Ejecutar [CT005-05](tests.md#ct005-05) y guardar evidencia de [AC005-05](acceptance.md#ac005-05).
- Estado. Pendiente.

### T005-06 · Presupuesto Forge

- Dependencia. Revisar salida de `T005-05`.
- Entrega. Ejecutar benchmark, registrar umbrales observados y fijar configuración de lote autorizada.
- Verificación. Ejecutar [CT005-06](tests.md#ct005-06) y guardar evidencia de [AC005-06](acceptance.md#ac005-06).
- Estado. Pendiente.

[Plan](plan.md) · [Plantilla de tarea](../../docs/templates/TASK.md).
