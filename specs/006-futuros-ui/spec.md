# SDD-006 · Interfaz Futuros

## Resultado

Editar escenarios versionados y comparar predicciones reales, evidencia y contrapartidas con una UX accesible.

## Requisitos

- **R006-01 · Editor versionado**. PLANNER abre S0, clona a una revisión y modifica variables permitidas con unidad, rango y procedencia.

- **R006-02 · Estado de corrida**. El usuario autorizado solicita ejecución y observa progreso, estado terminal y fallos de manera segura.

- **R006-03 · Resultados y comparación**. Futuros presenta fechas y costes P50/P80/P90, probabilidad, intervalos, distribución y sensibilidad con trazabilidad.

- **R006-04 · Handoff a Agent X**. El usuario obtiene una referencia autorizada y utilizable para pedir interpretación de su corrida.

## Límites del incremento

- La UI interpreta estados y presenta salidas calculadas que conserva el motor.
- La comparación de corridas incompatibles informa las diferencias y restricciones.

## Fuente y navegación

[Plan maestro](../../CONTROL_TOWER_X_MASTER_PLAN.md), §§2, 5–7, 9, 12 y 13. [Diseño](plan.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md) · [Pruebas](tests.md).
