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

La página del proyecto Jira abre Overview con filtros, indicadores y la cadena de impacto de A-17. **Estado de la instalación** muestra la conexión de Forge y ofrece la carga de demostración a la cuenta administradora habilitada. El panel usa la cuenta activa de Jira y un rol vigente de Control Tower X.

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

Consultar la [arquitectura](docs/architecture/ARQUITECTURA.md), el [registro de decisiones](docs/decisions/REGISTRO_ADR.md) y las [plantillas](docs/templates/).
