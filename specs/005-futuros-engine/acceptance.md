# SDD-005 · Motor Futuros · aceptación

Deben aprobarse todos los criterios aplicables. El resultado por entorno se registra con revisión, hora, credencial identificada por rol y evidencia saneada.

### AC005-01

**Snapshot y validador / R005-01.** La entrada aceptada congela sus datos y una variante inválida crea cero trabajos pendientes. Evidencia en `CT005-01`.

### AC005-02

**Modelos base / R005-02.** El núcleo cumple CPM, beta-PERT, degeneración, calendario y comparación emparejada conforme a tolerancias. Evidencia en `CT005-02`.

### AC005-03

**Estadísticos y sensibilidad / R005-03.** Resultados son finitos y reproducibles. Cuantiles ordenados y bins suman iteraciones. Las ausencias están tipadas. Evidencia en `CT005-03`.

### AC005-04

**Ejecución asíncrona / R005-04.** La misma entrada produce salidas equivalentes bajo reordenamiento. Un worker vencido no publica. Evidencia en `CT005-04`.

### AC005-05

**Fixture A-17 / R005-05.** S1 afecta el objetivo y S2 mejora el criterio elegido con el coste o esfuerzo asociado. Cada valor proviene del motor. Evidencia en `CT005-05`.

### AC005-06

**Presupuesto Forge / R005-06.** Se dispone de un tamaño de lote probado y una estrategia para superar fallos transitorios según §5 y §13. Evidencia en `CT005-06`.

[Requisitos](spec.md) · [Casos](tests.md).
