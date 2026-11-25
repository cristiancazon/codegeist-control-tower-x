# SDD-002 · Datos y fixtures · pruebas

## Preparación

Ejecutar corpus reproducible, validaciones, comprobación de grafo, pruebas de repositorios y simulación de interrupciones. Aplicar migraciones y seed por una cuenta ADMIN autorizada. Confirmar lecturas Jira por usuario y smoke de la segunda instalación.

## Casos

### CT002-01

**Migraciones y constraints / AC002-01.** Forge development. Aplicar desde vacío, interrumpir y volver a ejecutar. Consultar esquema, constraints y consistencia.

### CT002-02

**Canon y adaptadores / AC002-02.** Contratos y development. Forzar página duplicada, 403, 429 e interrupción entre páginas. Validar estado final, auditoría y filtros.

### CT002-03

**Fixture Patagonia / AC002-03.** Local. Comparar digests, cardinalidades y meses. Recorrer aristas, comprobar objetivos y referencias de S0/S1/S2.

### CT002-04

**Bootstrap protegido / AC002-04.** Forge development. Ejecutar ante destino errado, repetir seed interrumpido, comparar cardinalidades y confirmar que el proyecto de control sigue intacto.

### CT002-05

**Aislamiento y retención / AC002-05.** Unidad y Forge development. Comparar mismos IDs locales en entornos distintos, verificar TTL con reloj fijo y probar revocación de ACL.

## Registro

Por cada caso guardar versión, fecha, entorno, fixture o comandos, resultado esperado y observado, y vínculo a evidencia. Evitar material sensible en capturas y logs. [Aceptación](acceptance.md) · [Plantilla de prueba](../../docs/templates/TEST.md).

### Evidencia local del 25 de noviembre de 2026

`npm run check` aprobó 36 pruebas, ESLint, TypeScript y el build en Windows con Node.js 22.23.4. Las pruebas de persistencia ejecutan el SQL del repositorio sobre SQLite en memoria con la adaptación de dialecto acotada a los tests. La versión de Forge CLI 16.0.0 reportó cero errores y cero advertencias en `forge lint`, con un aviso de aprobación para la versión mayor por `write:jira-work`. La ejecución en Jira development queda pendiente de esa autorización.

| Caso | Resultado local | Verificación pendiente |
| --- | --- | --- |
| CT002-01 | Reejecución de migraciones con interrupción simulada, constraints de mapeo y rechazo de destinos ajenos. Materialización y activación repetibles. | Ejecutar DDL en Forge SQL development. |
| CT002-02 | Paginación Jira, validación de contexto y pertenencia, 403, 429 y reanudación del cursor de conciliación por marcador. El diario respeta el plazo Jira para un reintento de creación. | Verificar en Jira las llamadas con usuario activo y el alcance de actualización de proyecciones. |
| CT002-03 | Dos generaciones equivalentes arrojan SHA-256 `569d204b8b523306a7e8660894a4516a902d9642907fcb99755c8ebc31e26fde`. Las pruebas recorren A-17 y verifican 120 paquetes de trabajo, 80 activos, 15 contratistas y 24 meses. | Completo en el entorno local requerido. |
| CT002-04 | El control de acceso rechaza otro sitio, proyecto o entorno. El diario y el mapeo SQL verifican unicidad y reanudación. | Confirmar las creaciones y la reanudación en PED, y comprobar un segundo proyecto antes y después. |
| CT002-05 | Dos bases locales con IDs iguales mantienen el acceso separado. Un rol revocado pierde acceso y un snapshot vencido deja de ser publicable con reloj fijo. | Probar dos instalaciones Forge y completar la purga que preserve referencias. |

La carga exige los IDs del sitio y del proyecto en las variables de `development`, una clave de proyecto PED verificada con Jira y autorización del usuario activo. El modelo conserva el estado de planificación del fixture y la identidad del ítem Jira. El estado de workflow de Jira se consulta en el adaptador. [App context de Forge](https://developer.atlassian.com/platform/forge/runtime-reference/app-context-api/) · [Seguridad del contexto](https://developer.atlassian.com/platform/forge/app-context-security/).
