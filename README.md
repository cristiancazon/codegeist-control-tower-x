# Control Tower X

Especificación y paquete SDD de una torre de control inteligente para megaproyectos energéticos. El proyecto ficticio **Patagonia Energy Development** conecta un atraso de insumos con sus consecuencias para equipos, cronograma, coste y contratistas. Futuros calcula escenarios reproducibles. Agent X explica la evidencia. Una persona aprueba la acción correctiva en Jira.

## Empezar

1. Leer el [plan maestro](CONTROL_TOWER_X_MASTER_PLAN.md) y las [reglas de trabajo](AGENTS.md).
2. Revisar la [checklist de accesos Atlassian](docs/security/CHECKLIST_ACCESOS_ATLASSIAN.md) y preparar un sitio de desarrollo autorizado.
3. Abrir [SDD-001 Foundations](specs/001-foundation/spec.md) y usar el [prompt inicial](docs/development/PROMPT_INICIAL_CODEX.md).
4. Registrar decisiones y evidencia conforme a la [metodología SDD](CONTROL_TOWER_X_MASTER_PLAN.md#10-metodología-sdd).

## Índice de incrementos

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

## Verificación local

Usá Node.js 22.23.4, npm y Forge CLI 16.0.0. Ejecutá desde la raíz del repositorio:

```sh
npm ci
npm run check
```

El comando ejecuta ESLint, TypeScript, las pruebas locales y el build de Custom UI. `static/control-tower/dist/index.html` es la entrada que empaqueta Forge.

## Prueba en Jira development

Comprobá la sesión del CLI con `forge whoami`. Si el manifiesto todavía carece de `app.id`, ejecutá `forge register 'Control Tower X'` una vez desde la raíz. Elegí un Developer Space destinado al proyecto o crealo si Forge lo solicita. La persona titular revisa y confirma los términos que presenta el CLI. [Registro Forge](https://developer.atlassian.com/platform/forge/cli-reference/register/).

Confirmá un sitio de pruebas autorizado. `forge site provision` recupera o prepara un sitio demo para el desarrollador. Con el build generado, ejecutá `forge lint`, `forge deploy -e development` y, para un sitio demo listo, `forge install -e development --product jira --demo-site`. Abrí **Control Tower X** desde la navegación de un proyecto y documentá el caso autorizado y el denegado en [pruebas de SDD-001](specs/001-foundation/tests.md). [Sitio demo](https://developer.atlassian.com/platform/forge/provision-a-demo-development-site/).

### Carga de Patagonia Energy Development

La carga en Jira requiere autorización del administrador del sitio demo para el permiso `write:jira-work`, que incrementa la versión mayor de la app. Configurá los dos identificadores públicos del destino en el entorno de Forge `development` antes de desplegar y actualizar la instalación. [Variables de Forge](https://developer.atlassian.com/platform/forge/cli-reference/variables-set/) · [Versiones de Forge](https://developer.atlassian.com/platform/forge/environments-and-versions/).

```powershell
forge variables set -e development CTX_DEMO_CLOUD_ID 'id-del-sitio-demo'
forge variables set -e development CTX_DEMO_JIRA_PROJECT_ID 'id-del-proyecto-ped'
forge deploy -e development
forge install --upgrade all -e development --product jira --demo-site
```

Abrí **Control Tower X** en PED con una cuenta que pueda administrar el proyecto, ver sus ítems y crearlos. En **Datos de demostración**, revisá el plan de carga de 120 ítems antes de confirmarlo. Podés reanudar una importación desde el mismo destino y la misma cuenta. Si Jira no confirma una creación, el botón de reanudación consulta de nuevo su marcador para recuperar el vínculo. Consultá el [registro de pruebas](specs/002-data-model/tests.md) para ver el estado de la verificación.

### Corridas de Futuros

Con el snapshot de demo publicado y el rol `PLANNER` en PED, abrí **Futuros**. Fijá la cantidad de muestras y la semilla compartida, iniciá S0, S1 y S2, y actualizá las corridas activas hasta que publiquen. La comparación usa resultados del mismo snapshot y semilla. Si una corrida propia venció, el reintento conserva sus parámetros y el historial. [Resultados de Jira development](specs/005-futuros-engine/tests.md#resultados-en-jira-development-del-26-de-noviembre-de-2026).

### Consultar a Agent X en Jira

En **Vista general** de PED, abrí la cadena de impacto de A-17 y elegí **Consultar a Agent X**. Rovo recibe la referencia del proyecto y consulta las evidencias con la cuenta activa. La consulta también queda disponible para copiar. Desde **Futuros**, podés abrir Agent X con la referencia exacta de una corrida publicada o pedir una comparación con los UUID de S0, S1 y S2. Las respuestas identifican el corte y el origen de las observaciones. [Pruebas en Jira development](specs/007-agent-x/tests.md).

### Consultar las integraciones

Abrí **Estado de la instalación → Integraciones del proyecto**. Jira indica si se confirmó `Browse Projects` y Rovo indica la disponibilidad comunicada por la sesión anfitriona. **Actualizar integraciones** vuelve a comprobar los accesos de la cuenta activa. Cada fuente opcional informa su estado y el recorrido alternativo. [Configuración opcional](specs/008-rovo-integrations/plan.md#perfil-base-y-condiciones-para-un-perfil-opcional) · [Evidencia](specs/008-rovo-integrations/tests.md).

### Proponer un correctivo en Jira development

En **Futuros**, abrí una corrida publicada de S2 con una cuenta `PLANNER` y elegí **Preparar propuesta**. Revisá texto, evidencia y destino. En **Decisiones**, otra cuenta con `APPROVER` y acceso a la evidencia registra una aprobación o un rechazo. El proponente confirma la creación en Jira en un paso separado. Si se pierde la respuesta, **Buscar incidencia en Jira** intenta confirmar el correctivo por su marcador antes de cerrar la propuesta. [Preparar el ensayo](specs/009-decisions/plan.md#perfil-de-demostración) · [Pruebas](specs/009-decisions/tests.md).

## Benchmark de Futuros en Forge staging

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
