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

## Protocolo de benchmark en staging

Prepará una instalación de staging con el [procedimiento del README](../../README.md#benchmark-de-futuros-en-forge-staging). La cuenta `PLANNER` debe poder leer todos los ítems del snapshot sellado. Registrá el SHA candidato, la versión de la app en Forge, las versiones de modelo, motor y generador, el hash del snapshot, la revisión del escenario, la semilla, el tamaño de lote y la concurrencia observada. Usá 4.000 muestras y fijá esos parámetros para las repeticiones del mismo escenario.

| Tramo | Inicio y fin de la medición | Muestra y objetivo |
| --- | --- | --- |
| Admisión | Reloj monotónico del cliente desde el envío de `futuros.startRun` hasta la respuesta que confirma el ID persistido | 30 solicitudes con claves de idempotencia distintas. p95 ≤2 s. Registrá por separado las respuestas fallidas |
| Cola inicial | `startedAt − createdAt` en el detalle de la corrida | Registrá esta espera aun cuando haya dos workers activos |
| Publicación | `finishedAt − createdAt` para cada corrida. Conservá el estado terminal y el hash de las publicadas | 20 corridas cálidas tras el calentamiento. p95 ≤90 s. Registrá las fallas y vencimientos de la serie |
| Ejecución e I/O | Eventos `futuros.workerTiming` por ID de corrida. Incluyen `inputMs`, `computeMs`, `persistenceAndCoordinationMs`, `invocationMs`, `savedBatches` y `outcome` | Conservá cada invocación y agrupá las continuaciones de una misma corrida. La persistencia y coordinación incluyen las operaciones del worker fuera de carga de entrada y cálculo |
| Corridas frías | Misma medición de publicación. Clasificá como fría la primera invocación que tomó la corrida cuando `processFirstInvocation` es `true` | Registrá cinco por separado. El indicador identifica el primer uso del worker en ese proceso. La espera de plataforma previa al handler queda dentro de la latencia total |

Consultá el detalle con `futuros.getRun` y las trazas con `forge logs -e staging --since 1h --limit 200` o con la vista de logs de Forge filtrada por sitio, entorno y módulo. Las marcas del servidor evitan sumar el intervalo de sondeo del navegador al tiempo de publicación. Si una corrida se reencola, la diferencia entre su tiempo total y sus invocaciones incluye las esperas entre continuaciones. Calculá p95 por rango más próximo, posición 29 de 30 para admisión y 19 de 20 para publicación cálida. [Logs de Forge](https://developer.atlassian.com/platform/forge/cli-reference/logs/) · [Umbrales de aceptación, §13.5](../../CONTROL_TOWER_X_MASTER_PLAN.md#135-umbrales-iniciales-de-aceptación).

Ejecutá aparte los casos de recuperación de CT005-04 y CT005-06. Registrá al menos tres órdenes de entrega, la interrupción en las fronteras de persistencia, despacho y agregado, y el estado final y hash frente a una corrida sin interrupciones con la misma entrada. Si usás un doble de prueba para inducir la falla, anotá el entorno y el mecanismo junto con la evidencia. [Casos de prueba](tests.md).

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
