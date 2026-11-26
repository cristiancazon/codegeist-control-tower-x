# SDD-006 · Interfaz Futuros · pruebas

## Preparación

Probar flujos y validaciones de UI con DTO validados. Ejecutar prueba de concurrencia de ediciones y accesibilidad. Usar instalación Forge con al menos un VIEWER y un PLANNER y datos de A-17.

## Casos

### CT006-01

**Editor versionado / AC006-01.** Frontend y Forge development. Editar retraso de 15 días, probar valor negativo y reenvío con revisión antigua. Repetir como VIEWER.

### CT006-02

**Estado de corrida / AC006-02.** Integración Forge. Recargar durante un cálculo, provocar cancelación y 429 y consultar ID de otra instalación o proyecto.

### CT006-03

**Resultados y comparación / AC006-03.** Contrato y E2E development. Comparar tabla y gráfico con tres corridas verificables. Cambiar semilla y verificar tratamiento de incompatibilidad.

### CT006-04

**Handoff a Agent X / AC006-04.** E2E del sitio con Rovo. Solicitar interpretación de S1 y usar una referencia ajena. Verificar citas y resultado de denegación.

## Registro

Por cada caso guardar versión, fecha, entorno, fixture o comandos, resultado esperado y observado, y vínculo a evidencia. Evitar material sensible en capturas y logs. [Aceptación](acceptance.md) · [Plantilla de prueba](../../docs/templates/TEST.md).

### Evidencia local y de Jira development del 26 de noviembre de 2026

`npm run check` aprobó 119 pruebas, ESLint, TypeScript y el build de Custom UI. Las observaciones de Jira de esta sección corresponden a development 3.7.0, con `PLANNER` en PED y snapshot de Patagonia con corte 24 de noviembre de 2026. La versión final del incremento se desplegó como development 3.8.0 y staging 2.2.0.

| Caso | Evidencia observada |
| --- | --- |
| CT006-01 | Con `PLANNER` en PED, el editor rechazó −1 día y publicó `V-1803F6D6` r1 con 15 días. Dos pestañas abrieron r1. La primera publicó r2 con 16 días y la segunda recibió el rechazo de revisión obsoleta. La corrida de r1 siguió disponible. Las pruebas locales también cubren escritura concurrente, `VIEWER` y revocación de `PLANNER`. |
| CT006-02 | Una recarga conservó la URL de la corrida pendiente y el sondeo mostró el resultado publicado de 4.000 muestras. Otra corrida quedó **Cancelada** y conservó su enlace. Development rechazó el ID existente de una corrida de staging. Las pruebas locales verificaron el backoff y la espera indicada por `Retry-After` en una respuesta 429. |
| CT006-03 | La comparación de las corridas de referencia mostró +14 días y +USD 167.500 para S1 frente a S0, y +4 días y +USD 112.500 para S2 frente a S0. El detalle de la nueva revisión mostró USD 46.232.500 como costo P80 y tablas accesibles para percentiles P50/P80/P90, objetivos de cumplimiento, hitos y sensibilidad. Al comparar la variante con otra semilla apareció «Corridas incompatibles para el emparejamiento. Difieren en semilla.». La vista conservó las métricas individuales y omitió los deltas emparejados. |
| CT006-04 | **Abrir Agent X** inició Rovo Chat con la referencia exacta. La respuesta citó el snapshot, el corte y el hash `0bd23324af9de886bdb78974ae71b858a4632851c5c9eb61928582a9dbb32302`. El agente también informó indisponibilidad para un UUID inexistente y para el ID de una corrida publicada en staging. |

- [Resultado publicado de la revisión de 15 días](https://one-atlas-wjzw.atlassian.net/jira/software/projects/PED/apps/262d9dea-7d8b-4b70-ab88-f868960c2e09/bde0a6c9-8bb3-4f6c-9440-ac46a5f66b2b/futuros/cd3c3027-ba19-4500-90e9-d92e6a42c824).
- [Corrida que quedó cancelada](https://one-atlas-wjzw.atlassian.net/jira/software/projects/PED/apps/262d9dea-7d8b-4b70-ab88-f868960c2e09/bde0a6c9-8bb3-4f6c-9440-ac46a5f66b2b/futuros/0048ae08-9677-4e1d-9601-97d6c7686929).
- [Corrida de la variante con otra semilla](https://one-atlas-wjzw.atlassian.net/jira/software/projects/PED/apps/262d9dea-7d8b-4b70-ab88-f868960c2e09/bde0a6c9-8bb3-4f6c-9440-ac46a5f66b2b/futuros/8b680fdb-32ba-43e5-a8dd-17155ad9d2c1).

### Pendientes en Jira development

- CT006-01. Comprobar la denegación con una segunda cuenta que solo tenga `VIEWER` en Jira.
- CT006-02. Observar un 429 real durante el sondeo.
- CT006-04. Repetir la prueba del agente con una segunda cuenta restringida.
