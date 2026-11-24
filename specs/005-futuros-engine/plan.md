# SDD-005 · Motor Futuros · plan técnico

## Dependencias

SDD-002. Revisar esquema de escenarios, grafo, fuentes y política de acceso a snapshot.

## Capas y decisiones

### R005-01 · Snapshot y validador

El input canónico incluye snapshot, escenario versionado, semilla, modelo y parámetros. El servidor autoriza acceso en el proyecto y valida coherencia estadística.

### R005-02 · Modelos base

Separar calendario y grafo de muestreo. Unidades, dependencia, utilización, percentiles e incertidumbre se resuelven según §5.

### R005-03 · Estadísticos y sensibilidad

Persistir versión y convención de cuantiles, materializar distribuciones y señalar sensibilidad indefinida. Evaluar tendencias y series según volumen y validación.

### R005-04 · Ejecución asíncrona

Persistir claves, leases y estado en SQL. Transportar identificadores acotados por Async Events. Aislar el snapshot, consolidar en orden estable y publicar una vez.

### R005-05 · Fixture A-17

Fijar fixture de §7 y parámetros de comparación. Registrar trazabilidad a snapshot, señales y supuestos compartidos.

### R005-06 · Presupuesto Forge

Medir lote representativo. Registrar duraciones, tamaño de almacenamiento, invocaciones, reintentos y ventana de recuperación.

## Evidencia por entorno

- Local. Ejecutar los oráculos de §13 con reloj y semilla fijados. Usar arrays conocidos para estadísticos y pruebas de entrega fuera de orden.
- Entorno real. Ejecutar el dataset completo en Forge development. Medir cola, CPU de cálculo, persistencia y recuperación.

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
