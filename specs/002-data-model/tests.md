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
