# SDD-003 · Overview · pruebas

## Preparación

Cargar vistas con estado completo, parcial, vacío y denegado. Ejecutar pruebas de accesibilidad con fixtures. Abrir Overview en la instalación con seed, medir latencia y validar vínculos reales de Jira.

## Casos

### CT003-01

**Contrato de Overview / AC003-01.** Unidad y contrato. Verificar cálculos y probar 403, permisos distintos y snapshot desactualizado.

### CT003-02

**Dashboard y visualización / AC003-02.** Frontend y manual. Simular carga y error, comprobar foco, lectura de etiquetas y tabla equivalente en dos anchos.

### CT003-03

**Navegación A-17 / AC003-03.** E2E development. Abrir la alerta desde el seed y recorrer sus links. Cambiar proyecto de destino en payload y comprobar denegación.

### CT003-04

**Medición y regresión / AC003-04.** Forge development. Medir 30 vistas, observar las cargas iniciales y provocar un conector degradado. Verificar lo observable.

## Registro

Por cada caso guardar versión, fecha, entorno, fixture o comandos, resultado esperado y observado, y vínculo a evidencia. Evitar material sensible en capturas y logs. [Aceptación](acceptance.md) · [Plantilla de prueba](../../docs/templates/TEST.md).

### Evidencia local del 25 de noviembre de 2026

`npm run check` aprobó 54 pruebas, ESLint, TypeScript y el build de Custom UI en Windows con Node.js 22.23.4.

| Caso | Resultado observado |
| --- | --- |
| CT003-01 | Las pruebas separan ítems abiertos, terminados, vencidos e invisibles. Verifican fase desconocida, corte distinto, denominador cero y respuesta parcial de Jira. Un filtro con ID de proyecto o actor se rechaza antes de consultar Jira. |
| CT003-02 | Con el bridge simulado y CSP que permite estilos de origen propio, Edge a 1360 y 375 px mostró seis indicadores y la tabla de ocho ubicaciones. Enter abrió la alerta y el desglose. La pantalla estrecha no tuvo desbordamiento de página y se comprobaron los estados parcial, vacío, denegado y error. |
| CT003-03 | El modelo prueba la cadena A-17 en el fixture materializado. Oculta los sucesores sin visibilidad Jira y los objetos de Assets que requieren otro adaptador. El insumo S1 se resuelve con su snapshot vigente y el día de demora validado. |
| CT003-04 | Las pruebas simulan la pérdida de una página posterior de Jira y verifican el estado parcial. Una denegación de Jira interrumpe la consulta. Cada respuesta registra ID de soporte, fuentes y duración sin títulos de ítems ni datos de cuenta. |

### Evidencia en Jira development del 25 de noviembre de 2026

Forge 3.3.0 en el proyecto PED con el fixture Patagonia cargado y una cuenta administradora autorizada.

| Caso | Resultado observado |
| --- | --- |
| CT003-01 | Overview mostró 120 ítems elegibles visibles. El filtro Planificación redujo el denominador a 20. Al seleccionar el 23 de octubre de 2026, Forge informó cobertura parcial y los indicadores sin snapshot mostraron «Sin datos». Al restablecer, se recuperaron las dos fuentes y el corte del snapshot vigente. El costo reporta el devengado sintético. Falta un presupuesto acumulado comparable para calcular desvío. |
| CT003-02 | Se abrió A-17 con Enter y se seleccionó la fase mediante teclado en la aplicación Jira. La verificación en dos anchos se hizo con el bridge simulado. Queda la prueba en Jira con una cuenta que tenga solo rol VIEWER. |
| CT003-03 | La primera versión, 3.2.0, devolvió `UNAVAILABLE` al abrir el detalle. Tras reescribir las consultas de relaciones, 3.3.0 mostró EQ-017, CON-03 y S1 con 15 días. Se abrieron en Jira PED-48, PED-64 y PED-83 desde el panel. La sustitución de proyecto se comprobó por contrato. Queda la prueba en Jira con una segunda identidad restringida. |
| CT003-04 | 30 actualizaciones consecutivas desde **Actualizar vista** hasta que se mostraron los indicadores. Las 30 tuvieron cobertura completa. p50 de 1,59 s, p95 de 2,10 s y máximo de 3,85 s. Los percentiles usan rango más próximo. Las cinco aperturas con recarga completa se midieron aparte en 16,56 s, 4,33 s, 5,13 s, 4,37 s y 4,79 s. La primera siguió al despliegue. La pérdida de página Jira se probó localmente. |
