# SDD-007 · Agent X · pruebas

## Preparación

Ejecutar pruebas de contrato de funciones, prompt de referencia, autorización, source filtering y salida tipada. Instalar módulos verificados y realizar cada consulta crítica como los perfiles elegibles y revocados.

## Casos

### CT007-01

**Registro y contexto Rovo / AC007-01.** Rovo en development. Instalar, buscar el agente y ejecutar una conversación sin contexto, otra con referencia válida y otra con proyecto ajeno.

### CT007-02

**Acciones de lectura / AC007-02.** Contrato y Rovo en sitio. Invocar por rol y contexto, y simular falta de autorización, error transitorio y ausencia de corrida.

### CT007-03

**Respuesta con evidencia / AC007-03.** Rovo en sitio. Consultar con corrida exitosa y fallida. Contrastar cada valor con Futuros. Insertar hallazgos incompatibles y probar explicación de limitaciones.

### CT007-04

**Inyección, errores y handoff / AC007-04.** Contrato y Rovo en sitio. Probar instrucciones incrustadas en datos, URLs hostiles, suplantación, proyecto ambiguo y falta de permiso. Revisar auditoría y Jira.

## Registro

Por cada caso guardar versión, fecha, entorno, fixture o comandos, resultado esperado y observado, y vínculo a evidencia. Evitar material sensible en capturas y logs. [Aceptación](acceptance.md) · [Plantilla de prueba](../../docs/templates/TEST.md).
