# SDD-005 · Motor Futuros · plan técnico

## Dependencias

SDD-002. Revisar esquema de escenarios, grafo, fuentes y política de acceso a snapshot.

## Capas y decisiones

### R005-01 · Snapshot y validador

El input canónico incorpora el snapshot y la revisión publicada de Patagonia, sus hashes, semilla, parámetros y versiones. Verificar cada fragmento y el hash conjunto antes de admitir una corrida. Consultar por usuario los ítems del snapshot y exigir `PLANNER` para iniciar o cancelar una corrida propia.

### R005-02 · Modelos base

Separar CPM lógico y cronograma factible con recursos. Usar días civiles corridos, Beta-PERT y uniformes HMAC-SHA256 indexadas. A-17 concentra el efecto de llegada, y los importes se conservan en centavos. Las series mensuales se diagnostican aparte con pruebas fuera de muestra.

### R005-03 · Estadísticos y sensibilidad

Persistir versión y convención de cuantiles, materializar distribuciones y señalar sensibilidad indefinida. Evaluar tendencias y series según volumen y validación.

### R005-04 · Ejecución asíncrona

Persistir claves, concesión, generación y estado en Forge SQL. La cola recibe solo el ID de corrida y admite dos ejecuciones concurrentes. Se guardan lotes de 100 en orden de muestra, con digest. Se publica un agregado una vez, tras comprobar la concesión. Revisar trabajo pendiente cada cinco minutos y aplicar el TTL de muestras. El reintento explícito de un propietario abre una corrida nueva enlazada a la anterior y conserva el input original. [Async Events](https://developer.atlassian.com/platform/forge/runtime-reference/async-events-api/) · [Disparador programado](https://developer.atlassian.com/platform/forge/manifest-reference/modules/scheduled-trigger/) · [Límites SQL](https://developer.atlassian.com/platform/forge/limits-sql/).

### R005-05 · Fixture A-17

Ejecutar las revisiones publicadas sobre el mismo snapshot y semilla. La vista inicial Futuros permite iniciar, consultar, cancelar y comparar corridas. SDD-006 amplía esa interfaz con edición, resultados detallados y navegación.

### R005-06 · Presupuesto Forge

Medir lote representativo. Registrar duraciones, tamaño de almacenamiento, invocaciones, reintentos y ventana de recuperación.

## Evidencia por entorno

- Local. Ejecutar los oráculos de §13 con reloj y semilla fijados. Usar arrays conocidos para estadísticos y pruebas de entrega fuera de orden.
- Jira development. Ejecutar S0, S1 y S2 sobre el dataset sellado. Verificar la comparación y repetir S1 para comprobar el hash publicado.
- Forge staging. Medir los percentiles de admisión y publicación conforme a §5 y §13.5. Registrar por separado la cola, el cálculo, las corridas frías y la recuperación ante fallas. [Evidencia de pruebas](tests.md).

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
