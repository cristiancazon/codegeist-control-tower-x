# SDD-010 · Release y hackathon · plan técnico

## Dependencias

SDD-003, SDD-004 y SDD-009 cerrados. SDD-008 aporta únicamente opciones verificadas. §8 aporta permisos y §11 fechas oficiales.

## Capas y decisiones

### R010-01 · Candidato y reglas

Consolidar estado de capacidades, tests, evidencias, bases, elegibilidad y distinción de opciones. Verificar fecha y zona en el portal oficial.

### R010-02 · Instalación como jurado

Documentar requisitos Jira, Rovo y permisos. Preparar bootstrap ADMIN explícito sobre proyecto dedicado, asignación de roles y paso de instalación compartida cuando corresponda.

### R010-03 · Ensayo y evidencia

Usar corridas con snapshot verificable, mantener visible la procedencia y conservar una versión de respaldo medible en el sitio.

### R010-04 · Liberación y entrega

Comprobar entorno, permisos de distribución, versión y recuperación. Coordinar envío con responsable y registrar la confirmación oficial.

## Evidencia por entorno

- Local. Ejecutar gates de build, contratos, regresiones, seguridad y oráculos. Preparar evidencias sanitizadas y verificar enlaces.
- Entorno real. Repetir instalación y seed en un sitio de demo fresco comparable al del jurado. Usar dos identidades para el ensayo y preparar instalación de producción según autorización.

## Perfil de evaluación

Usar un sitio Jira con Rovo y un proyecto dedicado `PED`. El perfil Jira pide `read:jira-work` y `write:jira-work`. Agent X usa las cinco acciones de lectura verificadas. Las integraciones opcionales se mantienen deshabilitadas en el candidato. [Evidencias de Agent X](../007-agent-x/tests.md) · [Matriz de integraciones](../008-rovo-integrations/tests.md).

1. Preparar el sitio de ensayo y el proyecto con el tipo Tarea, descripción y etiquetas editables. El operador identifica el `cloudId`, el ID numérico del proyecto y el ID del tipo. La configuración vincula el perfil a ese sitio y proyecto.
2. Configurar `CTX_DEMO_CLOUD_ID`, `CTX_DEMO_JIRA_PROJECT_ID` y `CTX_DECISIONS_ISSUE_TYPE_ID` en el entorno elegido. `CTX_EVALUATION_DEMO_ENABLED=true` activa el perfil de evaluación para ese destino. En staging, con `CTX_STAGING_ADOPT_FIXTURE=true`, la carga conserva el modo de vinculación de los ítems existentes. Para un sitio fresco se usa la carga sintética explícita, con autorización para crear 120 ítems.
3. Reconstruir desde lockfile con `npm ci` y `npm run check`. Ejecutar `forge lint`. En staging, `forge deploy -e staging` y `forge install -e staging --site <sitio-de-ensayo> --product jira`. Confirmar versión e instalación con `forge install list -e staging`.
4. El administrador del proyecto revisa el plan de carga desde **Estado de la instalación**. Tras preparar Patagonia, A activa `PLANNER` desde **Futuros**. B, con acceso Jira a la evidencia, activa `APPROVER` y `VIEWER` en **Decisiones** si su cuenta fue configurada en `CTX_DEMO_APPROVER_ACCOUNT_ID`. Registrar la matriz de acceso antes de la aprobación real. [Setup de Decisiones](../009-decisions/plan.md#perfil-de-demostración).
5. Ensayar los tres escenarios con semilla común, Agent X, la propuesta de S2, aprobación separada y correctivo único. Registrar las dos duraciones y comparar la incidencia con la huella de aprobación. El [borrador en inglés](submission.md) acompaña el recorrido y las pruebas de permisos.
6. Con autorización expresa de producción, usar el destino de evaluación correspondiente y publicar la revisión candidata. En Developer Console, habilitar Sharing para Jira y verificar el enlace desde un sitio o sesión de prueba con un administrador independiente. Mantener una instalación de ensayo y el commit compatible para recuperar versiones. [Instalar con Forge CLI](https://developer.atlassian.com/platform/forge/cli-reference/install/) · [Distribuir apps de Forge](https://developer.atlassian.com/platform/forge/distribute-your-apps/).

| Riesgo para evaluación | Control y evidencia |
| --- | --- |
| Otra instalación recibe configuración de Patagonia | El perfil se mantiene inactivo sin opt-in, cloud Jira y proyecto coincidentes. CI comprueba casos cruzados. |
| Otra cuenta puede aprobar o crear indebidamente | Comprobar actor separado, rol revocado y `Create Issues` en las cuentas de prueba. El caso incierto conserva conciliación. |
| Jurado sin Rovo o sin acceso a un origen opcional | Vista general, Operaciones y Futuros siguen disponibles para actores autorizados. Registrar si la sesión ofrece Agent X. La demo completa requiere Rovo. |
| Caducan snapshot o muestras durante la evaluación | Confirmar fechas de retención del fixture y de la corrida de referencia antes de grabar y antes del periodo de evaluación. Ensayar recuperación en staging y conservar una revisión conocida. |
| Enlaces de instalación o video inaccesibles | Verificar acceso con una sesión independiente y conservar enlaces y versión en el registro de envío. |

## Reglas contrastadas

El 27 de noviembre de 2026 se confirmó el cierre del 22 de diciembre a las **12:00 PST / 17:00 Buenos Aires**. La candidatura propuesta es **Apps for Specialized Industries**, con **Best Agents** sujeto al recorrido verificado. El envío requiere descripción e instrucciones en inglés, o sus traducciones, enlace de instalación y video público en YouTube. La duración objetivo de este proyecto es inferior a cinco minutos. La elegibilidad personal y del equipo se revisa con la persona titular antes de enviar. [Reglas de Codegeist](https://codegeist2026.devpost.com/rules) · [Recursos oficiales](https://codegeist2026.devpost.com/resources).

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
