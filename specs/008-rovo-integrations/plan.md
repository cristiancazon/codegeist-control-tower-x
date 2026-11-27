# SDD-008 · Integraciones y capacidades · plan técnico

## Dependencias

SDD-007 para handoff y autenticación. Cada integración requiere acceso, documentación, permisos y revisión del uso elegible.

## Capas y decisiones

### R008-01 · Matriz de habilitación

Registrar estado documentado, plan, región cuando aplique, compatibilidad, permisos y prueba mínima. Por defecto, las opciones esperan comprobación.

### R008-02 · Fuentes opcionales

Validar `app.compatibility` para Jira requerido y Confluence opcional en el mismo sitio. Aplicar documentación de JSM y Assets a endpoints y scopes efectivamente usados.

### R008-03 · MCP

Usar arquitectura, cliente, autenticación y superficie que aprueben las fuentes de §3 y las bases. Aplicar lectura permitida y rastreo de evidencia.

### R008-04 · Teamwork Graph y otras opciones Rovo

Distinguir API, conector, capacidad presentada por Rovo y función Preview. Liberar una opción solo con configuración, aislamiento y fallback demostrados.

## Evidencia por entorno

- Local. Ejecutar pruebas de matrices de capacidad, valores deshabilitados, mapeo de errores y filtrado de procedencia.
- Entorno real. Probar individualmente cada opción con una cuenta autorizada según el requisito oficial. Registrar entorno y estado real.

## Perfil base y condiciones para un perfil opcional

Revisión documental del 26 de noviembre de 2026. `integrations.get` toma el proyecto de Jira del contexto de Forge. El permiso `Browse Projects` se vuelve a comprobar sin selectores del navegador. Las lecturas configuradas se ejecutan con `asUser` y validan sitio, proyecto, rol y una referencia aprobada. La sesión de Jira observa Rovo con `rovo.isEnabled()` y la prueba del agente queda registrada aparte. [REST en Forge](https://developer.atlassian.com/platform/forge/apis-reference/product-rest-api-reference/) · [Forge bridge Rovo](https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/rovo/).

| Fuente | Operación y consentimiento para una prueba autorizada | Preparación de la instalación |
| --- | --- | --- |
| Confluence | `GET /wiki/api/v2/pages/{id}`. Scope `read:page:confluence`. Jira requerido y Confluence opcional, con instalación vinculada en el mismo sitio. | `CTX_CONFLUENCE_ENABLED=true`, `CTX_CONFLUENCE_CLOUD_ID`, `CTX_CONFLUENCE_JIRA_PROJECT_ID`, `CTX_CONFLUENCE_SPACE_ID`, `CTX_CONFLUENCE_PAGE_INDEX` con hasta 12 objetos `{pageId, phaseCode, subjectCode}` de páginas sintéticas. La comprobación usa la primera página. [Páginas v2](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/) · [Compatibilidad](https://developer.atlassian.com/platform/forge/app-compatibility/). |
| Jira Service Management | `GET /rest/servicedeskapi/servicedesk/{id}` y `GET /rest/servicedeskapi/request/{id}`. Scope clásico `read:servicedesk-request`. Acceso vigente del actor al portal o a la mesa y autorización HSE de la app. | `CTX_JSM_ENABLED=true`, `CTX_JSM_CLOUD_ID`, `CTX_JSM_JIRA_PROJECT_ID`, `CTX_JSM_SERVICE_DESK_ID`, `CTX_JSM_SERVICE_PROJECT_ID`, `CTX_JSM_SERVICE_PROJECT_KEY`, `CTX_JSM_REQUEST_TYPE_ID`, `CTX_JSM_SAMPLE_ISSUE_ID`. Usar un incidente sintético. [Mesas de servicio](https://developer.atlassian.com/cloud/jira/service-desk/rest/api-group-servicedesk/) · [Solicitudes](https://developer.atlassian.com/cloud/jira/service-desk/rest/api-group-request/). |
| Assets | `GET /jsm/assets/workspace/{workspaceId}/v1/object/{id}` mediante `requestJira`. Scope `read:cmdb-object:jira` y permiso del actor para el objeto. | `CTX_ASSETS_ENABLED=true`, `CTX_ASSETS_CLOUD_ID`, `CTX_ASSETS_JIRA_PROJECT_ID`, `CTX_ASSETS_WORKSPACE_ID`, `CTX_ASSETS_OBJECT_ID`, `CTX_ASSETS_OBJECT_TYPE_ID`. Usar un objeto sintético y verificar antes el plan, SKU y rol de Assets. [Rutas Forge](https://developer.atlassian.com/cloud/assets/assets-rest-api-guide/scopes-for-oauth-2-3lo-and-forge-apps/) · [Objetos](https://developer.atlassian.com/cloud/assets/rest/api-group-object/). |

Las variables son identificadores de configuración. La prueba local separa un permiso revocado, una respuesta degradada y una referencia confirmada. La matriz devuelve como máximo la operación, la hora y la referencia del objeto admitido. Los adaptadores no comparten respuestas entre cuentas. La migración de un app Jira a compatibilidad múltiple requiere una decisión específica porque las instalaciones activas impiden volver a compatibilidad única. [Migración de compatibilidad](https://developer.atlassian.com/platform/forge/migrating-a-forge-app-to-support-multiple-atlassian-apps/).

## Capacidades Preview

- **Rovo MCP.** El siguiente ensayo requiere una instalación de prueba con `rovo:mcp` y una acción propia GET que reutilice la autorización de A-17. La administración habilita esa herramienta en Connected apps para el sitio y un cliente obtiene consentimiento OAuth. Registrar el descubrimiento y una invocación permitida y denegada contra `https://mcp.atlassian.com/forge/<appId>`. El perfil base usa el agente Forge. [Módulo Rovo MCP](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp/).
- **Teamwork Graph.** El ensayo requiere un objetivo de prueba vinculado a un ítem Jira visible. Desde un resolver `asUser()` y con `read:graph:issue:jira` y `read:graph:goal:atlassian`, `jiraWorkItemGoals(id, first)` recibe el ARI del ítem comprobado en Jira. Restringir a la referencia esperada. Registrar resultado permitido, vacío, error parcial y revocación. El perfil base conserva evidencias en Jira, Forge y Futuros. [Consultas curadas](https://developer.atlassian.com/platform/teamwork-graph/curated-queries/) · [API](https://developer.atlassian.com/platform/teamwork-graph/call-the-teamwork-graph-api/) · [Scopes](https://developer.atlassian.com/platform/teamwork-graph/scopes/).
- **Rovo Skills.** Sigue deshabilitada. Un perfil futuro necesita un caso elegible, `rovo:skill`, comprobación en la instalación y un recorrido de respaldo. [Rovo Skill](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-skill/).

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
