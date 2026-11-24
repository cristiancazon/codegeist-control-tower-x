# SDD-005 · Motor Futuros

## Resultado

Calcular predicciones estadísticamente defendibles y reproducibles para cronograma, costes y variables operativas, con comparaciones de S0/S1/S2 en Forge.

## Requisitos

- **R005-01 · Snapshot y validador**. Validar DAG, calendario, distribuciones, moneda, horizonte y rangos antes de encolar.

- **R005-02 · Modelos base**. Calcular CPM, PERT, Monte Carlo y métricas operativas y de presupuesto con semillas reproducibles.

- **R005-03 · Estadísticos y sensibilidad**. Entregar probabilidades, intervalos, percentiles, riesgos y explicación de datos insuficientes.

- **R005-04 · Ejecución asíncrona**. Dispatcher, worker y agregador toleran fallo, redespacho, cancelación y orden distinto.

- **R005-05 · Fixture A-17**. S0, S1 y S2 producen resultados trazables con contraste esperable y riesgo explícito.

- **R005-06 · Presupuesto Forge**. La corrida de demo y su cola operan dentro del presupuesto acordado y límites vigentes.

## Límites del incremento

- Aplicar métodos y umbrales de datos de §5 por variable.
- Una corrida se publica tras validación e integridad del agregado.

## Fuente y navegación

[Plan maestro](../../CONTROL_TOWER_X_MASTER_PLAN.md), §§5–7, 9 y 13. [Diseño](plan.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md) · [Pruebas](tests.md).
