# SDD-001 · Fundaciones · pruebas

## Preparación

Fijar CLI, Node y lockfile. Ejecutar lint, comprobación de tipos, test y build sin secretos. Usar una instalación Jira de development con usuario autorizado, una segunda cuenta de prueba y un proyecto conocido.

## Casos

### CT001-01

**Inventario de capacidades / AC001-01.** Revisión de documentación y CLI local. Contrastar referencias y probar versiones instaladas con los comandos del CLI. Marcar requisito de entorno si falta acceso.

### CT001-02

**Base tipada y build reproducible / AC001-02.** Local. Clonar o provisionar checkout limpio, instalar desde lockfile y ejecutar chequeos y lint de Forge.

### CT001-03

**Contexto confiable / AC001-03.** Unidad y Forge development. Probar una llamada sana y otra con cuenta/proyecto sustituidos. Comparar la autorización y los logs filtrados.

### CT001-04

**Registro seguro y observabilidad / AC001-04.** Unidad y development. Inyectar un fallo con datos de prueba marcados como sensibles y comprobar que no aparecen en salida pública.

### CT001-05

**Humo Jira development / AC001-05.** Forge development. Abrir la página como cada identidad de prueba, capturar respuestas y consultar logs por correlación.

## Registro

Por cada caso guardar versión, fecha, entorno, fixture o comandos, resultado esperado y observado, y vínculo a evidencia. Evitar material sensible en capturas y logs. [Aceptación](acceptance.md) · [Plantilla de prueba](../../docs/templates/TEST.md).

### Evidencia local del 24 de noviembre de 2026

Windows, Node.js 22.23.4, npm 10.9.9 y Forge CLI 16.0.0. El manifiesto solicita `read:jira-work` para consultar `BROWSE_PROJECTS` por proyecto con el usuario actual. La UI obtiene el ID de proyecto de la respuesta del resolver. [Jira project page](https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-project-page/) · [Contexto Forge](https://developer.atlassian.com/platform/forge/app-context-security/) · [Get my permissions](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-permissions/#api-rest-api-3-mypermissions-get) · [Runtime Node](https://developer.atlassian.com/platform/forge/function-reference/nodejs-runtime/).

| Caso | Comando o acción | Resultado observado |
| --- | --- | --- |
| CT001-01 | `node --version`, `npm --version`, `forge --version` y revisión de referencias | Versiones locales verificadas. La disponibilidad efectiva de Jira y Rovo se comprueba en el sitio de desarrollo. |
| CT001-02 | `npm ci --offline --ignore-scripts` desde caché y `npm run check` en una copia limpia | Se instalaron 244 dependencias desde el lockfile. ESLint y TypeScript correctos, siete pruebas aprobadas y build de Vite con entrada HTML y rutas relativas a los recursos. El build también pasó en el árbol de trabajo. |
| CT001-03 | `npm test` | La prueba autorizada usa el proyecto de contexto. Los payloads con otro actor, instalación o proyecto se rechazan antes de llamar a Jira. Prueba en development pendiente. |
| CT001-04 | `npm test` | Una excepción artificial produce un ID común en resultado y log. La salida omite la excepción, el actor y la instalación. Prueba en development pendiente. |
| CT001-05 | `forge whoami` y `forge lint` | El CLI requiere iniciar sesión localmente. El lint de Forge exige registrar la app para obtener el ARI. La instalación, la página en Jira y el ensayo de dos identidades siguen pendientes. |
