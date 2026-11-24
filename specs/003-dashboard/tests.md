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
