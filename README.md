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

En SDD-001, la página de proyecto de Jira consulta `system.health` y muestra el estado de conexión y el ID de proyecto. El resolver verifica el acceso del usuario actual con Jira. SDD-002 incorpora el modelo de datos y los fixtures de demostración.

## Verificación local

Usá Node.js 22.23.4, npm y Forge CLI 16.0.0. Ejecutá desde la raíz del repositorio:

```sh
npm ci
npm run check
```

El comando ejecuta ESLint, TypeScript, las pruebas unitarias del resolver y el build de Custom UI. `static/control-tower/dist/index.html` es la entrada que empaqueta Forge.

## Prueba en Jira development

Comprobá la sesión del CLI con `forge whoami`. En un sitio de pruebas autorizado, registrá una única app con `forge register` si el manifiesto todavía carece de `app.id`. Con el build generado, corré `forge lint`, `forge deploy -e development` e instalá la app para Jira en ese sitio. Abrí **Control Tower X** desde la navegación de un proyecto y documentá el caso autorizado y el denegado en [pruebas de SDD-001](specs/001-foundation/tests.md).

Consultar la [arquitectura](docs/architecture/ARQUITECTURA.md), el [registro de decisiones](docs/decisions/REGISTRO_ADR.md) y las [plantillas](docs/templates/).
