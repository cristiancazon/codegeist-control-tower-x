# SDD-010 · Release y hackathon · pruebas

## Preparación

Ejecutar gates de build, contratos, regresiones, seguridad y oráculos. Preparar evidencias sanitizadas y verificar enlaces. Repetir instalación y seed en un sitio de demo fresco comparable al del jurado. Usar dos identidades para el ensayo y preparar instalación de producción según autorización.

## Casos

### CT010-01

**Candidato y reglas / AC010-01.** CI y revisión documental. Revisar links desde un entorno de invitado y reconstruir el candidato desde lockfile.

### CT010-02

**Instalación como jurado / AC010-02.** Forge staging y método de distribución autorizado. Repetir desde sitio fresco y registrar resultados de manejo sin Rovo y con Rovo elegible. Confirmar que el proyecto de control permanece intacto.

### CT010-03

**Ensayo y evidencia / AC010-03.** Sitio de demo y validación del medio. Reproducir dos veces desde fixtures, medir duración, contrastar `runId` e issue y abrir el video desde un navegador sin sesión.

### CT010-04

**Liberación y entrega / AC010-04.** Entorno de distribución y portal oficial. Abrir ruta de instalación y video desde el contexto correspondiente. Revisar recepción del portal y copia saneada del envío.

## Registro

Por cada caso guardar versión, fecha, entorno, fixture o comandos, resultado esperado y observado, y vínculo a evidencia. Evitar material sensible en capturas y logs. [Aceptación](acceptance.md) · [Plantilla de prueba](../../docs/templates/TEST.md).

### Resultados técnicos del 27 de noviembre de 2026

| Caso | Resultado observado | Evidencia pendiente |
| --- | --- | --- |
| CT010-01 | Revisión candidata `50121f86f9d57df44639d16521f2089f4d7268d7`. `npm run check` aprobó 156 pruebas, lint, tipos y build en local. GitHub Actions reconstruyó con `npm ci` en Node 22.23.4 y pasó el mismo control. Las reglas y la categoría propuesta se contrastaron en el portal oficial. [Ejecución de GitHub Actions](https://github.com/cristiancazon/codegeist-control-tower-x/actions/runs/45938718052) · [Reglas oficiales](https://codegeist2026.devpost.com/rules). | Enlace de instalación para una sesión de invitado. |
| CT010-02 | `forge deploy -e staging --non-interactive` publicó **2.3.0** con `forge lint` sin incidencias. `forge install list -e staging` mostró la instalación Jira existente actualizada a la línea mayor 2. Con la cuenta actual, PED mostró corridas de 4.000 muestras conservadas. Decisiones informó que necesita un destino configurado. El opt-in de evaluación siguió inactivo en staging. [Jira staging en PED](https://one-atlas-wjzw.atlassian.net/jira/software/projects/PED/apps/262d9dea-7d8b-4b70-ab88-f868960c2e09/1917a6a1-3453-4085-a00e-e7998f91d7c5). | Sitio fresco de evaluación y validación con la cuenta de jurado. |
| CT010-03 | Forge development **3.14.0** verificó la aprobación de la propuesta de S2 por otra cuenta, la creación de **PED-121** por el proponente y la denegación para una cuenta Jira sin rol de la app. Jira devolvió una coincidencia por el marcador exacto. Guion de 4:48 planificado. [Propuesta, incidencia y pruebas](../009-decisions/tests.md) · [Borrador en inglés](submission.md). | Dos recorridos cronometrados y grabación pública autorizada. |
| CT010-04 | Lista de comprobación y campos de envío documentados. | Autorización de producción, enlace compartido validado y confirmación oficial del envío. |

### Verificación de la revisión integrada

La revisión `d628426` pasó `npm run check` con **157 pruebas** y se desplegó en Forge staging **2.4.0**. La instalación existente habilitó Decisiones para PED y reutilizó el fixture sintético. El ensayo temporal en **2.5.0** recuperó una única incidencia tras perder el resultado de creación. Forge **2.6.0** volvió a desplegar el código limpio de `d628426` en la misma instalación. La propuesta, su auditoría y el vínculo a PED-122 se conservaron. [CI de la revisión integrada](https://github.com/cristiancazon/codegeist-control-tower-x/actions/runs/46050985111) · [Ensayo de conciliación](../009-decisions/tests.md#respuesta-perdida-y-creaciones-concurrentes-en-staging).

### Instalación en sitio fresco del 28 de noviembre de 2026

CT010-02 abrió Control Tower X en un sitio nuevo de Jira Cloud Standard para desarrollo. El espacio Kanban `PED` está gestionado por el equipo y se creó con **Acceso limitado**. Los metadatos del tipo Tarea confirmaron que título, descripción y etiquetas se pueden escribir y que la fecha de vencimiento es opcional. [Cloud Developer Bundle](https://www.atlassian.com/try/cloud/signup?developer=true) · [Acceso de espacios en Jira](https://support.atlassian.com/jira-software-cloud/docs/manage-how-people-access-your-team-managed-project/).

`forge install -e staging --site control-tower-x-qa.atlassian.net --product jira --confirm-scopes --non-interactive` creó una instalación propia de Jira. La revisión `33d0e29` se desplegó como Forge **2.7.0** con el perfil de evaluación ajustado temporalmente a QA. El diagnóstico mostró **Operativa** para Forge, **Verificada** para Jira y **Sin habilitar** para Rovo Chat. El plan indicó **Listo para cargar · 0 de 120 ítems vinculados**. Quedan pendientes la carga con la cuenta proponente, la prueba de revocación y la instalación mediante el enlace de distribución. [Control Tower X en PED QA](https://control-tower-x-qa.atlassian.net/jira/software/projects/PED/apps/262d9dea-7d8b-4b70-ab88-f868960c2e09/1917a6a1-3453-4085-a00e-e7998f91d7c5).
