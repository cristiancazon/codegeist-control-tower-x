# Registro de decisiones arquitectónicas

| ADR | Estado | Decisión y consecuencia | Verificación |
|---|---|---|---|
| ADR-001 | Aprobada a nivel de diseño | Forge hospedado y Custom UI en proyecto Jira. Validar distribución y scopes en sitio real | SDD-001 / AC001-05 |
| ADR-002 | Aprobada a nivel de diseño | Futuros calcula en TypeScript con snapshot congelado, semilla y resultados versionados. El benchmark determina el lote y capacidad de demo | SDD-005 / AC005-04 y AC005-06 |
| ADR-003 | Aprobada a nivel de diseño | Acciones Rovo de lectura. El flujo humano de Jira revalida identidad, estado y permiso y registra incertidumbre de entrega | SDD-007 / AC007-02 y SDD-009 / AC009-03, AC009-04 |
| ADR-004 | Sujeta a pruebas en sitio | Accesos opcionales por instalación. Mostrar procedencia alternativa o funcionalidad deshabilitada cuando corresponda | SDD-008 / AC008-01 a AC008-04 |
| ADR-005 | Verificada localmente el 25 de noviembre de 2026 | Habilitar el seed mediante sitio, proyecto y entorno Forge explícitos. Conciliar Jira con la identidad activa y registrar el vínculo en Forge SQL para reanudar | SDD-002 / AC002-02, AC002-04, AC002-05 |
| ADR-006 | Aplicada en development | Calcular Overview con permisos de Jira y del proyecto de la app. Toda métrica mantiene su fuente y fecha. El cliente solo elige fase y fecha de corte | SDD-003 / AC003-01, AC003-03, AC003-04 |

Para cada nueva ADR, registrar fecha, estado, contexto, decisión, alternativas evaluadas, consecuencias, mitigaciones, condición para revisarla, fuentes oficiales y criterios SDD afectados. Enlazar el registro desde el spec que adopta la decisión.

### ADR-005 · Destino de la carga inicial

La clave de un proyecto puede repetirse en varios sitios Jira. Se eligieron dos variables de entorno para vincular la carga al sitio demo y al ID de PED, comprobados con contexto de Forge y una lectura Jira del usuario activo. El seed queda deshabilitado sin esa configuración y el diario SQL de cada instalación evita duplicar ítems ante reintentos. El permiso de escritura se instala con consentimiento para la versión mayor de development. Revisar esta decisión antes de habilitar otro sitio o entorno. [App context de Forge](https://developer.atlassian.com/platform/forge/runtime-reference/app-context-api/) · [Variables de Forge](https://developer.atlassian.com/platform/forge/cli-reference/variables-set/) · [Pruebas del incremento](../../specs/002-data-model/tests.md).

### ADR-006 · Visibilidad de los indicadores de Overview

El 25 de noviembre de 2026 se adoptó la lectura Jira por usuario en cada consulta y el cruce por ID con las proyecciones Forge. El denominador de una métrica de Jira corresponde a los ítems elegibles visibles. Una búsqueda incompleta informa el estado de la fuente y la cobertura. Cambiar la fecha de corte permite evaluar vencimientos usando los estados Jira observados durante la consulta. Los datos sintéticos con fecha fija conservan el corte de su snapshot. Reevaluar este diseño cuando exista captura histórica autorizada de Jira o se habiliten datos reales de Assets y JSM. [Búsqueda Jira](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/) · [Plan de Overview](../../specs/003-dashboard/plan.md).
