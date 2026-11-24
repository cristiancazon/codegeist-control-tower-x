# Checklist de accesos Atlassian

El alcance obligatorio para el recorrido completo es Jira Cloud con la app Forge instalada, Rovo disponible para los dos usuarios de prueba y un proyecto reservado para datos sintéticos. Usá la [sección 8 del plan maestro](../../CONTROL_TOWER_X_MASTER_PLAN.md#8-accesos-y-configuración-de-atlassian) para endpoints, scopes, comandos de despliegue y criterios de conectividad.

## Obligatorios

| Listo | Responsable | Tarea | Evidencia registrable |
| --- | --- | --- | --- |
| ☐ | Titular de Forge | Ingresar en Developer Console. Designar propietario y añadir a los colaboradores que desarrollarán en development. | Nombre del registro, ARI una vez creado, roles de contribución y entornos autorizados. |
| ☐ | Admin del sitio | Preparar un sitio Cloud de pruebas. La ruta recomendada es aprovisionar el sitio demo de Forge y confirmar Jira y Rovo. | Host, plan disponible, fecha de vencimiento y prueba de Chat. |
| ☐ | Admin de Jira | Crear un proyecto dedicado y validar permisos y campos para crear issues de prueba y el correctivo. El tipo de destino permite resumen, descripción y etiquetas. | ID/key, issue type IDs, campos y lectura de metadata Jira. |
| ☐ | Admin de la app | Preparar dos identidades distintas con roles `PLANNER` y `APPROVER`. Ambas pueden ver la evidencia. El proponente puede crear issues. | Prueba de rol de cada actor y de bloqueo de autoaprobación. |
| ☐ | Responsable técnico | Instalar Node 22 LTS compatible, Git, npm, y Forge CLI. Completar `forge login` de forma local. Comprobar `forge whoami`. | Versiones de herramientas y confirmación de sesión, sin copiar credenciales. |
| ☐ | Titular del repo | Dar acceso al repositorio GitHub de trabajo y acordar rama base, revisión y permisos de CI. | URL y rama, ramas protegidas si corresponde. |
| ☐ | Titular de Forge y admin del sitio | En 001, registrar la app una sola vez, desplegar development e instalar para Jira. | Versión y sitio comprobados. SQL/KVS/cola listos y vista instalada. |
| ☐ | Equipo de ensayo | Habilitar y verificar Agent X en el Chat de Jira tras 007. Ejecutar con identidad autorizada y una de permisos limitados. | Dos resultados con fecha, versión y correlación. |

Fuentes. [Primeros pasos Forge](https://developer.atlassian.com/platform/forge/getting-started/), [Sitio demo](https://developer.atlassian.com/platform/forge/provision-a-demo-development-site/), [Acceso a Rovo](https://support.atlassian.com/organization-administration/docs/manage-rovo-access/), [Permisos Jira](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-permissions/).

## Recomendados

- [ ] Preparar una instalación de staging y ensayar con un administrador ajeno al equipo.
- [ ] Conectar Confluence del mismo sitio, con una página de prueba permitida y otra restringida. Registrar space ID/key y page IDs.
- [ ] Preparar JSM con service desk ID, tipo de solicitud e identidades con visibilidad comprobada para los incidentes sintéticos.
- [ ] Habilitar Assets si el plan lo incluye y registrar workspace ID, esquema, tipos, atributos y roles. Probar un objeto visible y otro fuera del alcance.
- [ ] Verificar límites Forge del entorno y acceso autorizado a logs de funciones y métricas.

Fuentes. [Compatibilidad Forge](https://developer.atlassian.com/platform/forge/app-compatibility/), [JSM Cloud REST](https://developer.atlassian.com/cloud/jira/service-desk/rest/), [Assets y planes](https://support.atlassian.com/assets/docs/what-are-the-differences-between-assets-in-cloud-and-server/), [Límites Forge](https://developer.atlassian.com/platform/forge/platform-quotas-and-limits/).

## Opcionales y salida a evaluación

- [ ] Si se ensaya Teamwork Graph, aprobar los scopes por objeto y comprobar una relación conocida con un issue permitido, con dos perfiles de acceso.
- [ ] Si se ensaya `rovo:mcp`, habilitar la herramienta en el sitio, autenticar al cliente permitido por OAuth y verificar que la respuesta respeta los permisos del actor. Documentar Preview.
- [ ] Si se usa Forge MCP para documentación, configurar el servidor oficial en el cliente elegido. Este acceso pertenece al desarrollo.
- [ ] Para publicar el instalador de jurado, obtener autorización de production, desplegar y seleccionar Sharing para Jira. Verificar instalación en sitio limpio y mantenerla durante el período de evaluación.
- [ ] Ensayar la guía inglesa para jueces, con activación del dataset y dos actores. Confirmar plazo y YouTube público con video inferior a cinco minutos.

Fuentes. [Graph API](https://developer.atlassian.com/platform/teamwork-graph/call-the-teamwork-graph-api/), [Rovo MCP para apps](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp/), [Forge MCP para desarrollo](https://developer.atlassian.com/platform/forge/ai-development-toolkit/forge-mcp/), [Distribución](https://developer.atlassian.com/platform/forge/distribute-your-apps/), [Reglas Codegeist](https://codegeist2026.devpost.com/rules).

Codex puede trabajar con host del sitio, entorno, repositorio, ARI, IDs técnicos y estado de accesos. El titular configura las credenciales en el CLI local o un gestor de secretos CI. Mantenerlas fuera de chat, archivos del repositorio, registros y evidencias.
