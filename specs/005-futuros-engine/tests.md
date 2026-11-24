# SDD-005 · Motor Futuros · pruebas

## Preparación

Ejecutar los oráculos de §13 con reloj y semilla fijados. Usar arrays conocidos para estadísticos y pruebas de entrega fuera de orden. Ejecutar el dataset completo en Forge development. Medir cola, CPU de cálculo, persistencia y recuperación.

## Casos

### CT005-01

**Snapshot y validador / AC005-01.** Unidad e integración. Aplicar STAT-01 y STAT-06 de §13 y mutaciones de fixture. Verificar que el resumen de entrada y fuentes coincide con el hash.

### CT005-02

**Modelos base / AC005-02.** Unidad estadística. Ejecutar STAT-01 a STAT-08 de §13 y comparar con cálculos independientes.

### CT005-03

**Estadísticos y sensibilidad / AC005-03.** Unidad estadística. Ejecutar STAT-05, STAT-10 y STAT-12 de §13. Contrastar arrays sencillos y el comportamiento en holdout.

### CT005-04

**Ejecución asíncrona / AC005-04.** Integración Forge. Probar STAT-09, pérdida entre persistir/encolar, duplicación concurrente, cancelación y vencimiento de lease.

### CT005-05

**Fixture A-17 / AC005-05.** Local y Forge development. Aplicar STAT-11. Repetir la corrida de S1 y comparar métricas y digest según contrato.

### CT005-06

**Presupuesto Forge / AC005-06.** Forge development. Medir p95 terminal y separar encolado y ejecución. Probar recuperación, límites y pérdida de consumidor.

## Registro

Por cada caso guardar versión, fecha, entorno, fixture o comandos, resultado esperado y observado, y vínculo a evidencia. Evitar material sensible en capturas y logs. [Aceptación](acceptance.md) · [Plantilla de prueba](../../docs/templates/TEST.md).
