# SDD-002 · Datos y fixtures · aceptación

Deben aprobarse todos los criterios aplicables. El resultado por entorno se registra con revisión, hora, credencial identificada por rol y evidencia saneada.

### AC002-01

**Migraciones y constraints / R002-01.** Dos ejecuciones en el mismo entorno no repiten cambios. Un ID ajeno o una relación inválida se rechazan. Evidencia en `CT002-01`.

### AC002-02

**Canon y adaptadores / R002-02.** Los reintentos conservan claves naturales, progreso y pertenencia. Una fuente denegada se informa. Evidencia en `CT002-02`.

### AC002-03

**Fixture Patagonia / R002-03.** Dos generaciones equivalentes producen el mismo contenido canónico y la cadena A-17 conserva enlaces. Evidencia en `CT002-03`.

### AC002-04

**Bootstrap protegido / R002-04.** Segundo intento no duplica objetos. Una denegación ocurre antes de escribir fuera del destino confirmado. Evidencia en `CT002-04`.

### AC002-05

**Aislamiento y retención / R002-05.** Pedir referencias fuera de contexto no revela contenido ni existencia. Los borrados autorizados preservan relaciones o fallan de forma controlada. Evidencia en `CT002-05`.

[Requisitos](spec.md) · [Casos](tests.md).
