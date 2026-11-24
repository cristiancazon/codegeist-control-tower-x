# SDD-006 · Interfaz Futuros · pruebas

## Preparación

Probar flujos y validaciones de UI con DTO validados. Ejecutar prueba de concurrencia de ediciones y accesibilidad. Usar instalación Forge con al menos un VIEWER y un PLANNER y datos de A-17.

## Casos

### CT006-01

**Editor versionado / AC006-01.** Frontend y Forge development. Editar retraso de 15 días, probar valor negativo y reenvío con revisión antigua. Repetir como VIEWER.

### CT006-02

**Estado de corrida / AC006-02.** Integración Forge. Recargar durante un cálculo, provocar cancelación y 429 y consultar ID de otra instalación o proyecto.

### CT006-03

**Resultados y comparación / AC006-03.** Contrato y E2E development. Comparar tabla y gráfico con tres corridas verificables. Cambiar semilla y verificar tratamiento de incompatibilidad.

### CT006-04

**Handoff a Agent X / AC006-04.** E2E del sitio con Rovo. Solicitar interpretación de S1 y usar una referencia ajena. Verificar citas y resultado de denegación.

## Registro

Por cada caso guardar versión, fecha, entorno, fixture o comandos, resultado esperado y observado, y vínculo a evidencia. Evitar material sensible en capturas y logs. [Aceptación](acceptance.md) · [Plantilla de prueba](../../docs/templates/TEST.md).
