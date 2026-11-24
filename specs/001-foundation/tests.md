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
| CT001-01 | `node --version`, `npm --version`, `forge --version` y revisión de referencias | Versiones locales verificadas. Forge confirmó el sitio demo activo, con vencimiento el 22 de febrero de 2027. Jira abrió el tablero `PED` y mostró el acceso a Rovo. |
| CT001-02 | `npm ci --offline --ignore-scripts`, `npm run check` y `forge lint` | Se instalaron 244 dependencias desde el lockfile. ESLint y TypeScript correctos, siete pruebas aprobadas y build con rutas relativas a los recursos. Forge lint pasó sin observaciones. Se dejó `--noEmit` en el comando de verificación de tipos para que el bundler de Forge pueda emitir el backend. La comprobación completa volvió a pasar con ese ajuste. |
| CT001-03 | `npm test` y abrir la página en Jira development | La prueba autorizada usa el proyecto de contexto. Los payloads con otro actor, instalación o proyecto se rechazan antes de llamar a Jira. En Jira, el resolver devolvió estado operativo e ID `10202` para `PED`. Queda la prueba con una segunda identidad restringida. |
| CT001-04 | `npm test` y `forge logs -e development --since 10m` | Una excepción artificial produce un ID común en resultado y log. La salida omite la excepción, el actor y la instalación. En el sitio demo, Forge registró `system.health` con código `READY`, ID de correlación y duración de 440 ms en la ejecución observada. El fallo forzado quedó verificado localmente. |
| CT001-05 | `forge deploy -e development` y `forge install -e development --product jira --demo-site` | La app registrada se desplegó en development como `2.0.0`. La instalación explícita por URL devolvió un error genérico y el reintento por `--demo-site` fue exitoso. La página abrió desde la navegación de `PED` como usuario autorizado. La verificación con una cuenta sin `Browse Projects` sigue pendiente y la denegación unitaria pasó. |
