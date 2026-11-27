# Control Tower X

[English](#english) · [Español](#español)

## English

### Project controls for energy megaprojects in Jira

**Control Tower X** helps project directors and teams in planning, logistics and contracts assess a schedule risk and agree on a response in Jira. A late part can leave lifting equipment idle, delay commissioning and add standby costs. The app connects the shipment, equipment, contractor and affected work packages so each team can see where to intervene.

| Capability | What teams can do |
| --- | --- |
| **Control Tower** | Review progress, milestones, logistics, assets, contractors, health, safety and environment (HSE), and cost indicators in a project view. Follow an alert to its Jira work items and check the source, reporting date and coverage. |
| **Futuros** | Compare schedule and cost exposure before changing the plan. Run reproducible simulations with a shared snapshot and seed, then review percentiles, distributions and the probability of meeting both targets. |
| **Agent X** | Ask a Rovo agent which work is affected or what changed across scenarios. It reads evidence available to the active account and cites Jira items or published Futuros results. |
| **Decisiones** | Turn a published scenario into a corrective proposal. A different person reviews the proposed text, evidence and Jira destination. The planner can then confirm creation in Jira, with an audit trail and reconciliation if Jira's response is lost. |

### See the trade-off in the Patagonia demo

**Patagonia Energy Development** is a synthetic energy megaproject with 120 Jira work items. Shipment **A-17** connects an inbound delay to lifting equipment, an installation work package and subsequent commissioning. The demo compares the baseline, a 15-day supply delay and alternate supply for the same part. The targets are 30 days and USD 46,195,000.

| Scenario | Schedule P80 | Cost P80 | Samples meeting both targets |
| --- | ---: | ---: | ---: |
| **S0** · Baseline | 26 days | USD 46,065,000 | 100% |
| **S1** · Supply delay | 40 days | USD 46,232,500 | 0% |
| **S2** · Alternate supply | 30 days | USD 46,177,500 | 93.48% |

Under these assumptions, the alternate supply scenario brings P80 schedule back to 30 days. Its P80 cost remains USD 112,500 above the baseline. These are modeled results from 4,000 samples per scenario with the same snapshot and seed. P80 reports the 80th percentile for each metric. [Published runs and result hashes](specs/005-futuros-engine/tests.md#resultados-en-jira-development-del-26-de-noviembre-de-2026)

### Technology

| Layer | Implementation |
| --- | --- |
| **User interface** | Atlassian Forge Custom UI inside Jira, built with React 19, TypeScript and Vite. [Jira project page](https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-project-page/) |
| **Backend and data** | Forge functions and resolvers on Node.js 22, Jira Cloud REST requests under the active account, Forge SQL for snapshots, runs and decisions, and Forge Async Events for simulation batches. [Architecture](docs/architecture/ARQUITECTURA.md) · [Forge SQL](https://developer.atlassian.com/platform/forge/storage-reference/sql/) · [Async Events](https://developer.atlassian.com/platform/forge/runtime-reference/async-events-api/) |
| **Simulation** | TypeScript engine using critical path scheduling, beta-PERT estimates and Monte Carlo sampling. Each published run records its snapshot, seed, model version and result hash. [Futuros design](specs/005-futuros-engine/plan.md) |
| **AI assistant** | Atlassian Rovo with five read-only Forge actions for project evidence and published simulations. [Agent X evidence](specs/007-agent-x/tests.md) · [Rovo agent module](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/) |
| **Quality** | ESLint, TypeScript, the Node.js test runner and GitHub Actions. The release candidate passed 156 automated tests and a smoke test in Forge staging. [Release evidence](specs/010-release/tests.md) |

The Jira and Rovo profile is verified on the demo site. The optional Confluence, Jira Service Management, Assets, Rovo MCP, Teamwork Graph and Rovo Skills capabilities are disabled in that profile. The A-17 proposal was confirmed in Jira development. A live review by a second account and corrective work item creation remain part of acceptance testing. [Integration evidence](specs/008-rovo-integrations/tests.md) · [Decision workflow evidence](specs/009-decisions/tests.md)

### Run the project

Use Node.js 22.23.4, npm and Forge CLI 16.0.0. Run these commands from the repository root.

```sh
npm ci
npm run check
```

The check runs lint, type checking, tests and the Custom UI build. Forge packages the UI from `static/control-tower/dist/index.html`.

1. Confirm your CLI session with `forge whoami`. Register an app if your manifest needs an `app.id`. Provision or select an authorized Jira demo site and build the app before deploying it. [Forge registration](https://developer.atlassian.com/platform/forge/cli-reference/register/) · [Demo site setup](https://developer.atlassian.com/platform/forge/provision-a-demo-development-site/)
2. Configure `CTX_DEMO_CLOUD_ID` and `CTX_DEMO_JIRA_PROJECT_ID` for the dedicated `PED` project. Run `forge lint`, `forge deploy -e development` and `forge install -e development --product jira --demo-site`. Open **Control Tower X** in the project's navigation. [Evaluation setup](specs/010-release/plan.md#perfil-de-evaluación)
3. As an authorized project administrator, open **Estado de la instalación** and review the plan before creating the 120 synthetic work items. Once the snapshot is published, start or compare the three scenarios in **Futuros**, trace A-17 in **Vista general** and query Agent X. A separate reviewer account handles the decision in **Decisiones**. [Fixture runbook](specs/002-data-model/plan.md) · [Demo and testing instructions](specs/010-release/submission.md)
4. For a staging benchmark, adopt the existing Jira fixture with `CTX_STAGING_ADOPT_FIXTURE=true`. Run the test protocol on the staging installation. [Staging commands](#benchmark-de-futuros-en-forge-staging) · [Benchmark protocol](specs/005-futuros-engine/plan.md#protocolo-de-benchmark-en-staging)

The [master plan](CONTROL_TOWER_X_MASTER_PLAN.md), [SDD increment index](#índice-de-incrementos) and [architecture decisions](docs/decisions/REGISTRO_ADR.md) trace the implementation from project context to an approved Jira correction.

## Español

### Control de megaproyectos energéticos desde Jira

**Control Tower X** ayuda a la dirección de proyecto y a los equipos de planificación, logística y contratos a evaluar un riesgo de plazo y acordar una respuesta en Jira. El atraso de un repuesto puede dejar un equipo de izaje parado, demorar el comisionado y sumar costos de espera. La app vincula el envío, el activo, el contratista y los paquetes de trabajo afectados para que cada equipo pueda identificar dónde intervenir.

| Capacidad | Qué pueden hacer los equipos |
| --- | --- |
| **Control Tower** | Consultar avance, hitos, logística, activos, contratistas, salud, seguridad y ambiente (HSE), e indicadores de costo. Abrir los ítems de Jira vinculados a una alerta y comprobar el origen, la fecha de corte y la cobertura. |
| **Futuros** | Comparar el riesgo de plazo y costo antes de cambiar el plan. Ejecutar simulaciones reproducibles con el mismo snapshot y semilla, y revisar percentiles, distribuciones y la probabilidad de cumplir ambos objetivos. |
| **Agent X** | Preguntarle a un agente de Rovo qué trabajo está afectado o qué cambió entre escenarios. Lee la evidencia visible para la cuenta activa y cita ítems Jira o resultados publicados de Futuros. |
| **Decisiones** | Convertir un escenario publicado en una propuesta correctiva. Otra persona revisa el texto propuesto, la evidencia y el destino en Jira. El planificador puede confirmar la creación, con auditoría y conciliación si se pierde la respuesta. |

### Qué muestra la demo Patagonia

**Patagonia Energy Development** es un megaproyecto energético sintético con 120 ítems Jira. El envío **A-17** vincula una demora de suministro con un equipo de izaje, un paquete de montaje y el comisionado posterior. La demo compara el plan base, un atraso de 15 días y un suministro alternativo para el mismo repuesto. Los objetivos son 30 días y USD 46.195.000.

| Escenario | Plazo P80 | Costo P80 | Muestras que cumplen ambos objetivos |
| --- | ---: | ---: | ---: |
| **S0** · Plan base | 26 días | USD 46.065.000 | 100 % |
| **S1** · Atraso de suministro | 40 días | USD 46.232.500 | 0 % |
| **S2** · Suministro alternativo | 30 días | USD 46.177.500 | 93,48 % |

Bajo estos supuestos, el suministro alternativo recupera un plazo P80 de 30 días. Su costo P80 supera al plan base en USD 112.500. Los resultados provienen de 4.000 muestras por escenario con el mismo snapshot y la misma semilla. P80 indica el percentil 80 de cada métrica. [Corridas publicadas y hashes de resultados](specs/005-futuros-engine/tests.md#resultados-en-jira-development-del-26-de-noviembre-de-2026)

### Tecnologías

| Capa | Implementación |
| --- | --- |
| **Interfaz** | Atlassian Forge Custom UI dentro de Jira, con React 19, TypeScript y Vite. [Página de proyecto Jira](https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-project-page/) |
| **Backend y datos** | Funciones y resolvers de Forge sobre Node.js 22, API REST de Jira Cloud con la cuenta activa, Forge SQL para snapshots, corridas y decisiones, y Forge Async Events para procesar simulaciones por lotes. [Arquitectura](docs/architecture/ARQUITECTURA.md) · [Forge SQL](https://developer.atlassian.com/platform/forge/storage-reference/sql/) · [Async Events](https://developer.atlassian.com/platform/forge/runtime-reference/async-events-api/) |
| **Simulación** | Motor TypeScript con ruta crítica, estimaciones beta-PERT y muestreo Monte Carlo. Cada corrida publicada registra snapshot, semilla, versión del modelo y hash del resultado. [Diseño de Futuros](specs/005-futuros-engine/plan.md) |
| **Asistente de IA** | Atlassian Rovo con cinco acciones Forge de lectura para consultar evidencia del proyecto y simulaciones publicadas. [Evidencia de Agent X](specs/007-agent-x/tests.md) · [Módulo Rovo Agent](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/) |
| **Calidad** | ESLint, TypeScript, el ejecutor de pruebas de Node.js y GitHub Actions. El candidato aprobó 156 pruebas automatizadas y una verificación básica en Forge staging. [Evidencia de entrega](specs/010-release/tests.md) |

El perfil Jira y Rovo está verificado en el sitio demo. Las funciones opcionales de Confluence, Jira Service Management, Assets, Rovo MCP, Teamwork Graph y Rovo Skills están deshabilitadas en ese perfil. La propuesta de A-17 se confirmó en Jira development. La aprobación por una segunda cuenta y la creación real del correctivo forman parte de las pruebas de aceptación pendientes. [Evidencia de integraciones](specs/008-rovo-integrations/tests.md) · [Evidencia de Decisiones](specs/009-decisions/tests.md)

### Empezar

1. Leer el [plan maestro](CONTROL_TOWER_X_MASTER_PLAN.md) y las [reglas de trabajo](AGENTS.md).
2. Revisar la [checklist de accesos Atlassian](docs/security/CHECKLIST_ACCESOS_ATLASSIAN.md) y preparar un sitio de desarrollo autorizado.
3. Abrir [SDD-001 Foundations](specs/001-foundation/spec.md) y usar el [prompt inicial](docs/development/PROMPT_INICIAL_CODEX.md).
4. Registrar decisiones y evidencia conforme a la [metodología SDD](CONTROL_TOWER_X_MASTER_PLAN.md#10-metodología-sdd).

### Índice de incrementos

| SDD | Resultado |
|---|---|
| [001](specs/001-foundation/spec.md) | Página Forge y resolver con identidad |
| [002](specs/002-data-model/spec.md) | Esquema, fixtures reproducibles y sincronización |
| [003](specs/003-dashboard/spec.md) | Overview y cadena A-17 |
| [004](specs/004-projects-assets/spec.md) | Proyectos, recursos y señales operativas |
| [005](specs/005-futuros-engine/spec.md) | Motor estadístico y corridas reproducibles |
| [006](specs/006-futuros-ui/spec.md) | Edición, resultados y comparación de escenarios |
| [007](specs/007-agent-x/spec.md) | Agente Rovo con evidencia verificable |
| [008](specs/008-rovo-integrations/spec.md) | Integraciones y validación de capacidades |
| [009](specs/009-decisions/spec.md) | Aprobación y escritura correctiva en Jira |
| [010](specs/010-release/spec.md) | Candidato, ensayo y entrega |

La página del proyecto Jira abre Overview con filtros, indicadores y la cadena de impacto de A-17. **Explorar proyecto** reúne las vistas operativas. **Futuros** permite consultar escenarios publicados y, con `PLANNER`, iniciar corridas reproducibles. **Estado de la instalación** muestra la conexión de Forge y ofrece la carga de demostración a la cuenta administradora habilitada. Las vistas usan la cuenta activa de Jira y un rol vigente de Control Tower X.

### Verificación local

Usá Node.js 22.23.4, npm y Forge CLI 16.0.0. Ejecutá estos comandos desde la raíz del repositorio.

```sh
npm ci
npm run check
```

El comando ejecuta ESLint, TypeScript, las pruebas locales y el build de Custom UI. `static/control-tower/dist/index.html` es la entrada que empaqueta Forge.

### Prueba en Jira development

Comprobá la sesión del CLI con `forge whoami`. Si el manifiesto todavía carece de `app.id`, ejecutá `forge register 'Control Tower X'` una vez desde la raíz. Elegí un Developer Space destinado al proyecto o crealo si Forge lo solicita. La persona titular revisa y confirma los términos que presenta el CLI. [Registro Forge](https://developer.atlassian.com/platform/forge/cli-reference/register/).

Confirmá un sitio de pruebas autorizado. `forge site provision` recupera o prepara un sitio demo para el desarrollador. Con el build generado, ejecutá `forge lint`, `forge deploy -e development` y, para un sitio demo listo, `forge install -e development --product jira --demo-site`. Abrí **Control Tower X** desde la navegación de un proyecto y documentá el caso autorizado y el denegado en [pruebas de SDD-001](specs/001-foundation/tests.md). [Sitio demo](https://developer.atlassian.com/platform/forge/provision-a-demo-development-site/).

#### Carga de Patagonia Energy Development

La carga en Jira requiere autorización del administrador del sitio demo para el permiso `write:jira-work`, que incrementa la versión mayor de la app. Configurá los dos identificadores públicos del destino en el entorno de Forge `development` antes de desplegar y actualizar la instalación. [Variables de Forge](https://developer.atlassian.com/platform/forge/cli-reference/variables-set/) · [Versiones de Forge](https://developer.atlassian.com/platform/forge/environments-and-versions/).

```powershell
forge variables set -e development CTX_DEMO_CLOUD_ID 'id-del-sitio-demo'
forge variables set -e development CTX_DEMO_JIRA_PROJECT_ID 'id-del-proyecto-ped'
forge deploy -e development
forge install --upgrade all -e development --product jira --demo-site
```

Abrí **Control Tower X** en PED con una cuenta que pueda administrar el proyecto, ver sus ítems y crearlos. En **Datos de demostración**, revisá el plan de carga de 120 ítems antes de confirmarlo. Podés reanudar una importación desde el mismo destino y la misma cuenta. Si Jira no confirma una creación, el botón de reanudación consulta de nuevo su marcador para recuperar el vínculo. Consultá el [registro de pruebas](specs/002-data-model/tests.md) para ver el estado de la verificación.

#### Corridas de Futuros

Con el snapshot de demo publicado y el rol `PLANNER` en PED, abrí **Futuros**. Fijá la cantidad de muestras y la semilla compartida, iniciá S0, S1 y S2, y actualizá las corridas activas hasta que publiquen. La comparación usa resultados del mismo snapshot y semilla. Si una corrida propia venció, el reintento conserva sus parámetros y el historial. [Resultados de Jira development](specs/005-futuros-engine/tests.md#resultados-en-jira-development-del-26-de-noviembre-de-2026).

#### Consultar a Agent X en Jira

En **Vista general** de PED, abrí la cadena de impacto de A-17 y elegí **Consultar a Agent X**. Rovo recibe la referencia del proyecto y consulta las evidencias con la cuenta activa. La consulta también queda disponible para copiar. Desde **Futuros**, podés abrir Agent X con la referencia exacta de una corrida publicada o pedir una comparación con los UUID de S0, S1 y S2. Las respuestas identifican el corte y el origen de las observaciones. [Pruebas en Jira development](specs/007-agent-x/tests.md).

#### Consultar las integraciones

Abrí **Estado de la instalación → Integraciones del proyecto**. Jira indica si se confirmó `Browse Projects` y Rovo indica la disponibilidad comunicada por la sesión anfitriona. **Actualizar integraciones** vuelve a comprobar los accesos de la cuenta activa. Cada fuente opcional informa su estado y el recorrido alternativo. [Configuración opcional](specs/008-rovo-integrations/plan.md#perfil-base-y-condiciones-para-un-perfil-opcional) · [Evidencia](specs/008-rovo-integrations/tests.md).

#### Proponer un correctivo en Jira development

En **Futuros**, abrí una corrida publicada de S2 con una cuenta `PLANNER` y elegí **Preparar propuesta**. Revisá texto, evidencia y destino. En **Decisiones**, otra cuenta con `APPROVER` y acceso a la evidencia registra una aprobación o un rechazo. El proponente confirma la creación en Jira en un paso separado. Si se pierde la respuesta, **Buscar incidencia en Jira** intenta confirmar el correctivo por su marcador antes de cerrar la propuesta. [Preparar el ensayo](specs/009-decisions/plan.md#perfil-de-demostración) · [Pruebas](specs/009-decisions/tests.md).

### Benchmark de Futuros en Forge staging

Usá el sitio Jira demo autorizado y el proyecto PED con los 120 ítems sintéticos del fixture ya cargados. Configurá los identificadores del mismo destino en `staging`. Forge guarda los datos de la app de cada entorno en su propia instalación. [Entornos y variables de Forge](https://developer.atlassian.com/platform/forge/environments-and-versions/) · [Instalación en sitio demo](https://developer.atlassian.com/platform/forge/provision-a-demo-development-site/).

```powershell
forge variables set -e staging CTX_DEMO_CLOUD_ID 'id-del-sitio-demo'
forge variables set -e staging CTX_DEMO_JIRA_PROJECT_ID 'id-del-proyecto-ped'
forge variables set -e staging CTX_STAGING_ADOPT_FIXTURE true
forge deploy -e staging
forge install -e staging --product jira --demo-site
forge install list -e staging
```

Si ya existe una instalación de staging y Forge indica que requiere actualizarla, usá `forge install --upgrade all -e staging --product jira --demo-site`. Abrí la entrada de **Control Tower X (STAGING)** dentro de PED con una cuenta autenticada que pueda leer y administrar ese proyecto Jira. En **Datos de demostración**, elegí **Ver plan de carga**, confirmá los vínculos y seleccioná **Vincular ítems existentes**. La app verifica el conjunto completo y guarda el modelo en Forge SQL de staging con lecturas de Jira. Si falta un ítem o su identidad difiere del fixture, resolvé la discrepancia antes de reanudar. [Comandos de instalación](https://developer.atlassian.com/platform/forge/cli-reference/install/).

Elegí **Actualizar estado** hasta ver **Carga completa**. Abrí **Futuros** con la misma cuenta y confirmá **Asignar mi rol PLANNER en PED**. Usá el [protocolo de SDD-005](specs/005-futuros-engine/plan.md#protocolo-de-benchmark-en-staging) para registrar admisión, cola, cálculo, persistencia y publicación.

Consultar la [arquitectura](docs/architecture/ARQUITECTURA.md), el [registro de decisiones](docs/decisions/REGISTRO_ADR.md) y las [plantillas](docs/templates/).
