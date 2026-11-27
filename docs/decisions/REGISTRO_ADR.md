# Registro de decisiones arquitectónicas

| ADR | Estado | Decisión y consecuencia | Verificación |
|---|---|---|---|
| ADR-001 | Aprobada a nivel de diseño | Forge hospedado y Custom UI en proyecto Jira. Validar distribución y scopes en sitio real | SDD-001 / AC001-05 |
| ADR-002 | Aprobada a nivel de diseño | Futuros calcula en TypeScript con snapshot congelado, semilla y resultados versionados. El benchmark determina el lote y capacidad de demo | SDD-005 / AC005-04 y AC005-06 |
| ADR-003 | Aprobada a nivel de diseño | Acciones Rovo de lectura. El flujo humano de Jira revalida identidad, estado y permiso y registra incertidumbre de entrega | SDD-007 / AC007-02 y SDD-009 / AC009-03, AC009-04 |
| ADR-004 | Sujeta a pruebas en sitio | Accesos opcionales por instalación. Mostrar procedencia alternativa o funcionalidad deshabilitada cuando corresponda | SDD-008 / AC008-01 a AC008-04 |
| ADR-005 | Verificada localmente el 25 de noviembre de 2026 | Habilitar el seed mediante sitio, proyecto y entorno Forge explícitos. Conciliar Jira con la identidad activa y registrar el vínculo en Forge SQL para reanudar | SDD-002 / AC002-02, AC002-04, AC002-05 |
| ADR-006 | Aplicada en development | Calcular Overview con permisos de Jira y del proyecto de la app. Toda métrica mantiene su fuente y fecha. El cliente solo elige fase y fecha de corte | SDD-003 / AC003-01, AC003-03, AC003-04 |
| ADR-007 | Aplicada en development | Usar snapshot de demo y mapeos Jira vigentes en las vistas operativas. Mostrar y autorizar por separado las conexiones de Assets, JSM y Confluence | SDD-004 / AC004-01 a AC004-04 |
| ADR-008 | Aplicada en development | Congelar la entrada de Futuros por hashes. Procesar lotes deterministas de 100 y publicar una generación con concesión vigente | SDD-005 / AC005-01, AC005-04, AC005-06 |
| ADR-009 | Aplicada en development | Publicar revisiones inmutables de A-17 con validación de la revisión de origen y acceso vigente. Usar referencias de corrida para navegar y consultar Agent X | SDD-006 / AC006-01 a AC006-04 |
| ADR-010 | Aplicada en development | Exponer a Agent X cinco acciones de lectura con identidad de Forge, comprobación de acceso vigente y proyección explícita de procedencia | SDD-007 / AC007-01 a AC007-04 |
| ADR-011 | Aplicada en development | Observar capacidades de la instalación con la cuenta activa y exigir opt-in por fuente | SDD-008 / AC008-01 a AC008-04 |
| ADR-012 | Verificada en development | Congelar la propuesta y reservar la creación de Jira tras una aprobación por una cuenta distinta | SDD-009 / AC009-01 a AC009-04 |

Para cada nueva ADR, registrar fecha, estado, contexto, decisión, alternativas evaluadas, consecuencias, mitigaciones, condición para revisarla, fuentes oficiales y criterios SDD afectados. Enlazar el registro desde el spec que adopta la decisión.

### ADR-005 · Destino de la carga inicial

La clave de un proyecto puede repetirse en varios sitios Jira. Se eligieron dos variables de entorno para vincular la carga al sitio demo y al ID de PED, comprobados con contexto de Forge y una lectura Jira del usuario activo. El seed queda deshabilitado sin esa configuración y el diario SQL de cada instalación evita duplicar ítems ante reintentos. El permiso de escritura se instala con consentimiento para la versión mayor de development. Revisar esta decisión antes de habilitar otro sitio o entorno. [App context de Forge](https://developer.atlassian.com/platform/forge/runtime-reference/app-context-api/) · [Variables de Forge](https://developer.atlassian.com/platform/forge/cli-reference/variables-set/) · [Pruebas del incremento](../../specs/002-data-model/tests.md).

### ADR-006 · Visibilidad de los indicadores de Overview

El 25 de noviembre de 2026 se adoptó la lectura Jira por usuario en cada consulta y el cruce por ID con las proyecciones Forge. El denominador de una métrica de Jira corresponde a los ítems elegibles visibles. Una búsqueda incompleta informa el estado de la fuente y la cobertura. Cambiar la fecha de corte permite evaluar vencimientos usando los estados Jira observados durante la consulta. Los datos sintéticos con fecha fija conservan el corte de su snapshot. Reevaluar este diseño cuando exista captura histórica autorizada de Jira o se habiliten datos reales de Assets y JSM. [Búsqueda Jira](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/) · [Plan de Overview](../../specs/003-dashboard/plan.md).

### ADR-007 · Origen y permisos en las vistas operativas

El 25 de noviembre de 2026 se implementaron ocho vistas para el proyecto autorizado. El backend consulta Jira como usuario activo para validar cada ítem vinculado y consulta Forge SQL para los catálogos sintéticos del snapshot. Cada detalle vuelve a comprobar el rol de proyecto. HSE exige `HSE_READER` adicional y Conocimiento solo usa el catálogo vinculado al fixture sellado. Los conectores quedan sin habilitar hasta confirmar su ámbito, sus permisos y la lectura en el sitio. [Plan de SDD-004](../../specs/004-projects-assets/plan.md).

### ADR-008 · Reproducibilidad y publicación de Futuros

El perfil V1 usa el snapshot sellado de Patagonia. El historial sintético queda congelado en el snapshot y Jira comprueba la visibilidad de todos sus ítems para cada actor interactivo. Se eligió el muestreo indexado con HMAC-SHA256 para que la semilla común sobreviva a la reentrega y al orden de los lotes. Forge SQL registra muestras compactas y un resultado con generación, que solo publica el dueño vigente de la concesión. El mismo snapshot y versiones habilitan la comparación emparejada mientras se conservan sus muestras. La edición general de escenarios y los lectores de otros perfiles dependen de contratos y validación adicionales. [Plan de Futuros](../../specs/005-futuros-engine/plan.md).

El 26 de noviembre de 2026, Forge 3.6.0 publicó cuatro corridas de 4.000 muestras en Jira development. Forge SQL requirió límites constantes en las lecturas paginadas. El reintento conserva la configuración original y enlaza la nueva corrida al intento previo. En Forge staging se midieron admisión y publicación, y se recuperaron dos corridas tras fallas controladas. [Evidencia de Futuros](../../specs/005-futuros-engine/tests.md).

### ADR-009 · Revisión de escenarios y consulta de resultados

El 26 de noviembre de 2026 se limitó la edición de Patagonia al atraso de A-17. La definición publicada conserva unidad, procedencia, revisión y hash. Una restricción por familia y revisión resuelve publicaciones concurrentes y deja accesibles las corridas anteriores. Un enlace a una corrida abre su detalle y vuelve a validar el acceso. Agent X aplica el mismo límite de lectura antes de recibir agregados. [Pruebas de la interfaz Futuros](../../specs/006-futuros-ui/tests.md).

### ADR-010 · Evidencia autorizada en Rovo

Agent X toma la identidad del contexto de invocación de Forge. El ID del proyecto, los UUID de corrida y los filtros se tratan como selectores. Se reutilizan las verificaciones de Jira y Control Tower X de las pantallas. Las respuestas proyectan el corte, las unidades, las referencias y las métricas publicadas sin incluir texto Jira ajeno a la consulta. El catálogo de conocimiento se etiqueta como sintético y declara el conector Confluence deshabilitado. [Plan de Agent X](../../specs/007-agent-x/plan.md) · [Contrato de acciones Forge](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/).

### ADR-011 · Observación de integraciones por cuenta

El 26 de noviembre de 2026 se incorporó una matriz de integración al perfil Jira. Se eligió verificar de nuevo al consultar, porque el acceso de una persona puede cambiar entre sesiones. JSM, Assets y Confluence requieren configuración del servidor vinculada al sitio y al proyecto, consentimiento y ACL de la fuente. Se evaluó instalar todas las fuentes en el perfil base. Se mantuvieron los permisos del perfil Jira y los recorridos sintéticos ante indisponibilidad. La conexión opcional de Confluence requiere una revisión de migración separada. Las opciones Preview se revisan cuando existe un entorno autorizado y evidencia reproducible. [Diseño y fuentes oficiales](../../specs/008-rovo-integrations/plan.md#perfil-base-y-condiciones-para-un-perfil-opcional) · [Evidencia](../../specs/008-rovo-integrations/tests.md).

### ADR-012 · Propuesta versionada y conciliación Jira

El 27 de noviembre de 2026 se eligió un registro inmutable de propuesta con revisión y SHA-256. La aprobación conserva el motivo y la cuenta revisora. La reserva SQL exige la cuenta proponente, la revisión aprobada, vigencia y roles activos. Se evaluó reintentar automáticamente tras un timeout. Se adoptó la conciliación explícita porque la búsqueda de Jira puede tardar en reflejar una creación y una respuesta perdida deja incierto el resultado. El perfil admite una propuesta nueva cuando cambia el texto. Revisar concurrencia y recuperación antes de cambiar el destino o ampliar el perfil de distribución. [Diseño y fuentes oficiales](../../specs/009-decisions/plan.md#perfil-de-demostración) · [Casos de prueba](../../specs/009-decisions/tests.md).
