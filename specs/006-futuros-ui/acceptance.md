# SDD-006 · Interfaz Futuros · aceptación

Deben aprobarse todos los criterios aplicables. El resultado por entorno se registra con revisión, hora, credencial identificada por rol y evidencia saneada.

### AC006-01

**Editor versionado / R006-01.** Guardar una revisión válida preserva rastreo. Una tentativa inválida o stale produce error explícito. Evidencia en `CT006-01`.

### AC006-02

**Estado de corrida / R006-02.** QUEUED, RUNNING, SUCCEEDED, FAILED y CANCELED tienen estados accesibles. Una recarga reanuda la vista correcta. Evidencia en `CT006-02`.

### AC006-03

**Resultados y comparación / R006-03.** Valores y unidades coinciden con salida almacenada. Corridas no emparejables quedan señaladas y no producen deltas emparejados. Evidencia en `CT006-03`.

### AC006-04

**Handoff a Agent X / R006-04.** Agent X recibe una referencia de una corrida autorizada y vuelve a consultar la evidencia antes de responder. Evidencia en `CT006-04`.

[Requisitos](spec.md) · [Casos](tests.md).
