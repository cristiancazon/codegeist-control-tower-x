# SDD-005 · Motor Futuros · pruebas

## Preparación

Ejecutar los oráculos de §13 con reloj y semilla fijados. Usar arrays conocidos para estadísticos y pruebas de entrega fuera de orden. Validar los resultados del dataset completo en Jira development. Ejecutar el protocolo de capacidad en Forge staging.

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

**Presupuesto Forge / AC005-06.** Medir p95 de admisión y publicación en Forge staging. Separar cola y ejecución y registrar las corridas frías aparte. Probar recuperación, límites y pérdida de consumidor.

## Registro

Por cada caso guardar versión, fecha, entorno, fixture o comandos, resultado esperado y observado, y vínculo a evidencia. Evitar material sensible en capturas y logs. [Aceptación](acceptance.md) · [Plantilla de prueba](../../docs/templates/TEST.md).

### Evidencia local del 25 y 26 de noviembre de 2026

`npm run check` aprobó 106 pruebas, ESLint, TypeScript y el build con Node.js 22.23.4. Motor `cpm-pert-v1`, build `futuros-1.0.0` y generador `hmac-sha256-v1`. Perfil Patagonia con corte 24 de noviembre de 2026, semilla `00000000000000000000000020261125` y 4.000 muestras por escenario.

| Caso | Resultado observado |
| --- | --- |
| CT005-01 | Un fragmento alterado, una variable incongruente y un snapshot vencido impidieron preparar la entrada. El acceso al snapshot exige el mapeo visible de todo el proyecto del fixture. |
| CT005-02 | Las pruebas comprobaron DAG, calendario civil, Beta-PERT, degeneración, capacidad sin solapamiento y choques emparejados. |
| CT005-03 | Se verificaron cuantiles tipo 7, Wilson, empates en Spearman, censura, masa del histograma y diagnóstico mensual con origen creciente. |
| CT005-04 | SQLite con SQL adaptado comprobó duplicación y reordenamiento, pérdida entre guardar y actualizar progreso, recuperación, cancelación y publicación con concesión vencida. El ensayo de portabilidad rechaza límites parametrizados y verifica la lectura paginada y el reintento del propietario. |
| CT005-05 | El oráculo modal cerró en 26, 37 y 27 días. Los deltas modales de coste frente a S0 fueron USD 144.500 para S1 y USD 89.500 para S2. Se calculó el resultado estadístico sobre las muestras compartidas indicadas abajo. |
| CT005-06 | Cada caso completo de 4.000 muestras tardó aproximadamente de 2,2 a 3,8 s en el ensayo local, incluida la agregación. Forge usa lotes de 100, un límite de 128 KiB por lote y dos ejecuciones concurrentes. El p95 de staging requiere el ensayo en ese entorno. |

| Escenario | Plazo P80 | Costo P80 | Cumplimientos conjuntos | Muestras censuradas |
| --- | --- | --- | --- | --- |
| S0 | 26 días | USD 46.065.000 | 4.000 de 4.000 | 0 |
| S1 | 40 días | USD 46.232.500 | 0 de 4.000 | 0 |
| S2 | 30 días | USD 46.177.500 | 3.739 de 4.000 | 0 |

El cálculo usa el plazo objetivo de 30 días y el presupuesto de USD 46.195.000. El 93,475 % observado en S2 es una estimación condicional a esos supuestos y a los datos sintéticos.

### Primera admisión en Jira development

El 25 de noviembre se confirmó el rol `PLANNER` para la cuenta administradora del proyecto demo PED. Forge 3.5.0 admitió S0, S1 y S2 en 1.248, 1.205 y 1.232 ms y mostró dos corridas en ejecución y una en cola. Forge registró el error SQL 1210 al ejecutar consultas con `LIMIT ?`. La corrección usa límites constantes para el agregado por páginas, la recuperación y el mantenimiento de snapshots. Las corridas originales conservan su historial.

### Resultados en Jira development del 26 de noviembre de 2026

En Forge 3.6.0, `PLANNER` reintentó en PED las tres corridas vencidas, con el snapshot, la semilla y las 4.000 muestras por escenario indicados arriba. Jira mostró las corridas originales como `RUN_TIMEOUT` y los tres reintentos como **Resultado publicado**, con 4.000 muestras procesadas en cada uno. Una corrida independiente de S1 con los mismos parámetros publicó el mismo hash completo.

| Corrida | Plazo P80 | Costo P80 | Cumplimiento conjunto en Jira | Hash del resultado |
| --- | --- | --- | --- | --- |
| S0 | 26 días | USD 46.065.000 | 100 % | `2234b9c7d2108ec3255f1499f7e2689ced7e3690a7ce5b402670d0d5b7580468` |
| S1 | 40 días | USD 46.232.500 | 0 % | `0bd23324af9de886bdb78974ae71b858a4632851c5c9eb61928582a9dbb32302` |
| S2 | 30 días | USD 46.177.500 | 93,48 % | `a4dbcf8a02030765b992ba447e344ffa83e35bb4dd61f911a8f23756780108df` |
| Repetición de S1 | 40 días | USD 46.232.500 | 0 % | `0bd23324af9de886bdb78974ae71b858a4632851c5c9eb61928582a9dbb32302` |

La comparación emparejada mostró +14 días y +USD 167.500 para S1 frente a S0, y +4 días y +USD 112.500 para S2 frente a S0. El navegador mostró cada reintento en cola unos 2,1 s después del clic y confirmó la publicación de la repetición de S1 en la comprobación a los 27 s. [Futuros en el proyecto PED](https://one-atlas-wjzw.atlassian.net/jira/software/projects/PED/apps/262d9dea-7d8b-4b70-ab88-f868960c2e09/bde0a6c9-8bb3-4f6c-9440-ac46a5f66b2b).

### Capacidad en Forge staging 2.0.0 del 26 de noviembre de 2026

La instalación de staging de PED vinculó en lectura los 120 ítems existentes. Se admitieron 30 corridas de S0 con 4.000 muestras, la semilla del oráculo local y hasta dos workers activos. Los registros de Forge confirmaron 30 publicaciones y 40 lotes guardados por corrida. Los tiempos se cruzaron por ID de corrida y se calcularon por rango más próximo.

| Medición | n | p50 | p95 | Máximo |
| --- | ---: | ---: | ---: | ---: |
| Admisión en el resolver | 30 | 1,25 s | 1,84 s | 2,27 s |
| Desde admisión hasta publicación, tanda cálida posterior | 20 | 10,38 s | 10,92 s | 10,95 s |
| Desde admisión hasta publicación, total de corridas cálidas | 25 | 10,66 s | 32,73 s | 34,65 s |
| Desde admisión hasta publicación, primer uso del worker | 5 | 13,66 s | 13,90 s | 13,90 s |
| Cálculo y agregado dentro del worker | 30 | 5,45 s | 6,07 s | 6,37 s |
| Persistencia y coordinación dentro del worker | 30 | 4,71 s | 5,45 s | 5,62 s |
| Espera estimada desde la respuesta hasta el ingreso al worker | 30 | 0,38 s | 22,52 s | 23,50 s |

La primera tanda tuvo dos esperas de cola mayores a 22 s. La medición desde el clic hasta observar la URL con el ID dio p95 de 3,84 s e incluye navegación y observación de la interfaz. La medición directa del bridge se realizó en la segunda serie. [Futuros en Forge staging](https://one-atlas-wjzw.atlassian.net/jira/software/projects/PED/apps/262d9dea-7d8b-4b70-ab88-f868960c2e09/1917a6a1-3453-4085-a00e-e7998f91d7c5) · [Protocolo del plan maestro, §13.5](../../CONTROL_TOWER_X_MASTER_PLAN.md#135-umbrales-iniciales-de-aceptación).

### Admisión exacta y recuperación en Forge staging 2.1.0

La segunda serie midió `performance.now()` alrededor de `invoke` en Custom UI, desde el envío hasta recibir el ID persistido. El rango más próximo sobre 30 admisiones de S0 con 4.000 muestras dio p50 de **1,508 s**, p95 de **1,675 s** y máximo de **1,926 s**. El mínimo fue 1,318 s. Las dos corridas de recuperación se ejecutaron aparte de las series de admisión y rendimiento.

| Falla inducida | Estado observado en Jira | Resultado |
| --- | --- | --- |
| Se omitió el primer envío a la cola de S1 tras persistir y reservar el despacho | En cola con 0 muestras | El recuperador publicó las 4.000 muestras en el mismo ID `cb7342f7-1f22-49e0-a726-9f989c1b94bb`. Coincidió el hash de S1 registrado en development. |
| Se detuvo el worker de S2 tras guardar su primer lote y con la concesión vigente | En ejecución con 100 de 4.000 muestras | Tras el vencimiento, el recuperador publicó las 4.000 muestras en el mismo ID `15fcf1c1-a712-4428-81c2-e5a04c9397e6`. Coincidió el hash de S2 registrado en development. |

Las pruebas locales cubren entregas duplicadas, reordenamiento y pérdida intermedia durante la persistencia y el agregado. Las dos interrupciones de staging usaron una variante temporal del código limitada a corridas sintéticas de PED. Forge staging 2.2.0 retira esas fallas inducidas y conserva la medición de tiempos habilitada para el ensayo. [S1 recuperada](https://one-atlas-wjzw.atlassian.net/jira/software/projects/PED/apps/262d9dea-7d8b-4b70-ab88-f868960c2e09/1917a6a1-3453-4085-a00e-e7998f91d7c5/futuros/cb7342f7-1f22-49e0-a726-9f989c1b94bb) · [S2 recuperada](https://one-atlas-wjzw.atlassian.net/jira/software/projects/PED/apps/262d9dea-7d8b-4b70-ab88-f868960c2e09/1917a6a1-3453-4085-a00e-e7998f91d7c5/futuros/15fcf1c1-a712-4428-81c2-e5a04c9397e6).
