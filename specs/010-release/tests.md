# SDD-010 · Release y hackathon · pruebas

## Preparación

Ejecutar gates de build, contratos, regresiones, seguridad y oráculos. Preparar evidencias sanitizadas y verificar enlaces. Repetir instalación y seed en un sitio de demo fresco comparable al del jurado. Usar dos identidades para el ensayo y preparar instalación de producción según autorización.

## Casos

### CT010-01

**Candidato y reglas / AC010-01.** CI y revisión documental. Revisar links desde un entorno de invitado y reconstruir el candidato desde lockfile.

### CT010-02

**Instalación como jurado / AC010-02.** Forge staging y método de distribución autorizado. Repetir desde sitio fresco y registrar resultados de manejo sin Rovo y con Rovo elegible. Confirmar que el proyecto de control permanece intacto.

### CT010-03

**Ensayo y evidencia / AC010-03.** Sitio de demo y validación del medio. Reproducir dos veces desde fixtures, medir duración, contrastar `runId` e issue y abrir el video desde un navegador sin sesión.

### CT010-04

**Liberación y entrega / AC010-04.** Entorno de distribución y portal oficial. Abrir ruta de instalación y video desde el contexto correspondiente. Revisar recepción del portal y copia saneada del envío.

## Registro

Por cada caso guardar versión, fecha, entorno, fixture o comandos, resultado esperado y observado, y vínculo a evidencia. Evitar material sensible en capturas y logs. [Aceptación](acceptance.md) · [Plantilla de prueba](../../docs/templates/TEST.md).
