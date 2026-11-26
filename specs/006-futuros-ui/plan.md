# SDD-006 · Interfaz Futuros · plan técnico

## Dependencias

SDD-005. Consumir errores, valores de estado y resultados documentados en los contratos del motor.

## Capas y decisiones

### R006-01 · Editor versionado

El formulario parte de S0 o de la última revisión editable de su propia familia. El perfil inicial permite editar el atraso de suministro de A-17 en días corridos, de 0 a 365. Forge fija el proyecto, la referencia de suministro, el snapshot y la procedencia. La publicación valida `PLANNER`, el último número de revisión y la clave idempotente. Las revisiones publicadas y sus corridas conservan la entrada original.

### R006-02 · Estado de corrida

Consultar el progreso cada cinco segundos mientras la página está visible. Ante errores transitorios, esperar hasta treinta segundos entre consultas, con variación aleatoria y respeto de `Retry-After`. Al iniciar o abrir una corrida, su ID queda en la ruta de la página Jira. Tras recargar, el servidor vuelve a validar el acceso. [Navegación de Custom UI](https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/view/#createhistory).

### R006-03 · Resultados y comparación

Mostrar cuantiles, intervalos, probabilidad de cumplimiento, censura e histogramas con una tabla de recuentos accesible. El comparador vuelve a leer cada resultado y aplica las reglas de compatibilidad del motor. Si cambiaron la semilla o la cantidad de muestras, muestra las métricas individuales y explica la ausencia de deltas emparejados.

### R006-04 · Handoff a Agent X

La consulta copiable incluye los identificadores de proyecto Jira y corrida. La apertura directa verifica la disponibilidad de Rovo en el sitio y usa el agente de la misma app. La acción de lectura conserva la identidad de Forge y revalida el rol y la visibilidad Jira antes de devolver agregados y referencias. [Bridge de Rovo](https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/rovo/) · [Acciones Forge](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/).

## Evidencia por entorno

- Local. Probar flujos y validaciones de UI con DTO validados. Ejecutar prueba de concurrencia de ediciones y accesibilidad.
- Entorno real. Usar instalación Forge con al menos un VIEWER y un PLANNER y datos de A-17.

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
