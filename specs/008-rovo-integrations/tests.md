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
