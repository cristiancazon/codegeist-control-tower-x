# SDD-008 · Integraciones y capacidades · pruebas

## Preparación

Ejecutar pruebas de matrices de capacidad, valores deshabilitados, mapeo de errores y filtrado de procedencia. Probar individualmente cada opción con una cuenta autorizada según el requisito oficial. Registrar entorno y estado real.

## Casos

### CT008-01

**Matriz de habilitación / AC008-01.** Development. Levantar sitio con Jira y Rovo, sin conectores opcionales, y ejecutar flujo principal. En una instalación Jira sin Rovo, comprobar la UI operativa y el estado explícito del agente.

### CT008-02

**Fuentes opcionales / AC008-02.** Sitio con producto habilitado. Ejecutar pruebas por producto, página restringida, workspace sin autorización y ausencia de producto.

### CT008-03

**MCP / AC008-03.** Sitio y cliente compatibles. Ejecutar herramienta de lectura con identidad habilitada y otra denegada, y verificar la evidencia de cada una.

### CT008-04

**Teamwork Graph y otras opciones Rovo / AC008-04.** Sitio habilitado y revisión documental. Validar una relación o capacidad permitida y una revocación. Cuando falte acceso, ejecutar caso de capacidad deshabilitada.

## Registro

Por cada caso guardar versión, fecha, entorno, fixture o comandos, resultado esperado y observado, y vínculo a evidencia. Evitar material sensible en capturas y logs. [Aceptación](acceptance.md) · [Plantilla de prueba](../../docs/templates/TEST.md).

### Resultados del 26 de noviembre de 2026

`npm run check` pasó en Node.js 22.23.4 con 146 pruebas, incluidas 15 de integraciones. ESLint, TypeScript y el build terminaron correctamente. `forge lint` sin incidencias. `forge deploy -e development --non-interactive` publicó Forge **3.12.0** con el perfil base Jira de Control Tower X.

| Caso | Resultado observado | Pendiente |
| --- | --- | --- |
| CT008-01 | PED, proyecto Jira `10202`, cuenta actual `PLANNER`. Al abrir y actualizar **Estado de la instalación**, Jira verificó `BROWSE_PROJECTS` a las 17:05 y Rovo confirmó `rovo.isEnabled` a las 17:06, hora de Buenos Aires. Las seis opciones adicionales figuraron deshabilitadas con sus condiciones. Overview mostró A-17 con PED-48, PED-64 y PED-83. Futuros siguió mostrando S2 y resultados publicados de 4.000 muestras. Las acciones de Agent X ya cuentan con evidencia del entorno en 3.11.0. | Sesión Jira real con Rovo deshabilitado. [Acciones de Agent X](../007-agent-x/tests.md). |
| CT008-02 | Pruebas locales comprobaron destino exacto, autorización previa, alcance de la respuesta y degradación de Confluence, JSM y Assets. PED mostró las tres fuentes sin habilitar. | Una página, un incidente y un objeto sintéticos en un perfil autorizado con acceso y revocación de cada fuente. |
| CT008-03 | Rovo MCP figuró sin habilitar en PED. Se registró el contrato Preview y la operación candidata. | Módulo, herramienta aprobada y cliente elegible con consentimiento. |
| CT008-04 | Teamwork Graph y Rovo Skills figuraron sin habilitar en PED. Se registraron consulta, scopes y evidencia requerida para Graph. | Relación Jira–objetivo y prueba permitida y denegada en un perfil habilitado. |

[Instalación development en PED](https://one-atlas-wjzw.atlassian.net/jira/software/projects/PED/apps/262d9dea-7d8b-4b70-ab88-f868960c2e09/bde0a6c9-8bb3-4f6c-9440-ac46a5f66b2b) · [Plan por perfil](plan.md#perfil-base-y-condiciones-para-un-perfil-opcional).
