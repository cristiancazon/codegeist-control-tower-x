# SDD-009 · Decisiones y acción correctiva · aceptación

Deben aprobarse todos los criterios aplicables. El resultado por entorno se registra con revisión, hora, credencial identificada por rol y evidencia saneada.

### AC009-01

**Propuesta vinculada / R009-01.** Una propuesta autorizada se guarda con versión, autor, destino y vínculos. Referencias de otro proyecto se rechazan. Evidencia en `CT009-01`.

### AC009-02

**Aprobación humana / R009-02.** Doble clic registra una sola transición. Aprobar deja la propuesta apta para un acto de ejecución separado y produce cero llamadas Create Issue. Evidencia en `CT009-02`.

### AC009-03

**Escritura Jira confirmada / R009-03.** Un clic del proponente PLANNER con aprobación vigente permite reservar y crear una única incidencia confirmada con enlace y evidencia. Se rechazan un ejecutor distinto y una revocación de `Create Issues` antes de ejecutar. Evidencia en `CT009-03`.

### AC009-04

**Reconciliación y auditoría / R009-04.** Respuesta perdida provoca reconciliación. Tras confirmar, el resultado queda vinculado y la historia conserva quien hizo cada operación. Evidencia en `CT009-04`.

[Requisitos](spec.md) · [Casos](tests.md).
