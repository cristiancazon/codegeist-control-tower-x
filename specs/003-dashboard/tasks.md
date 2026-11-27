# SDD-003 · Overview · tareas

Cada tarea entrega código y evidencia en la etapa de implementación. Mantener las tareas pendientes hasta demostrar los criterios.

### T003-01 · Contrato de Overview

- Dependencia. Dependencias declaradas del spec.
- Entrega. Definir DTO, fórmulas y fixtures para estados completos y mixtos.
- Verificación. Ejecutar [CT003-01](tests.md#ct003-01) y guardar evidencia de [AC003-01](acceptance.md#ac003-01).
- Estado. Verificado con pruebas de contrato y los indicadores de PED. El desvío requiere presupuesto acumulado comparable.

### T003-02 · Dashboard y visualización

- Dependencia. Revisar salida de `T003-01`.
- Entrega. Construir página, tarjetas con evidencia, filtros de proyecto y estados de carga/fallo.
- Verificación. Ejecutar [CT003-02](tests.md#ct003-02) y guardar evidencia de [AC003-02](acceptance.md#ac003-02).
- Estado. Verificado con teclado en Jira y en dos anchos localmente. Queda probar con exclusivamente rol VIEWER en Jira.

### T003-03 · Navegación A-17

- Dependencia. Revisar salida de `T003-02`.
- Entrega. Cablear alerta al panel de detalle y al handoff de simulación cuando exista.
- Verificación. Ejecutar [CT003-03](tests.md#ct003-03) y guardar evidencia de [AC003-03](acceptance.md#ac003-03).
- Estado. Los tres enlaces Jira y el insumo S1 fueron verificados en development. Queda el ensayo con una segunda identidad restringida.

### T003-04 · Medición y regresión

- Dependencia. Revisar salida de `T003-03`.
- Entrega. Acoplar suite E2E, métricas y registro de benchmark a la revisión del incremento.
- Verificación. Ejecutar [CT003-04](tests.md#ct003-04) y guardar evidencia de [AC003-04](acceptance.md#ac003-04).
- Estado. Verificado en 30 actualizaciones y cinco aperturas iniciales. p95 de 2,10 s para las actualizaciones.

[Plan](plan.md) · [Plantilla de tarea](../../docs/templates/TASK.md).
