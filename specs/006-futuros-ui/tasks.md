# SDD-006 · Interfaz Futuros · tareas

Cada tarea entrega código y evidencia en la etapa de implementación. Mantener las tareas pendientes hasta demostrar los criterios.

### T006-01 · Editor versionado

- Dependencia. Dependencias declaradas del spec.
- Entrega. Crear editor, sugerencias de rango, mensajes de datos insuficientes y control de revisión.
- Verificación. Ejecutar [CT006-01](tests.md#ct006-01) y guardar evidencia de [AC006-01](acceptance.md#ac006-01).
- Estado. Jira development 3.7.0 publicó las revisiones y rechazó el valor negativo y el guardado obsoleto con `PLANNER`. El caso `VIEWER` pasó en local y queda pendiente con una segunda cuenta en Jira.

### T006-02 · Estado de corrida

- Dependencia. Revisar salida de `T006-01`.
- Entrega. Conectar comandos de corrida, seguimiento, reintento o cancelación donde corresponda.
- Verificación. Ejecutar [CT006-02](tests.md#ct006-02) y guardar evidencia de [AC006-02](acceptance.md#ac006-02).
- Estado. Jira development 3.7.0 verificó recarga, sondeo, cancelación y aislamiento de la instalación de staging. El backoff ante un 429 se verificó en local.

### T006-03 · Resultados y comparación

- Dependencia. Revisar salida de `T006-02`.
- Entrega. Crear pantalla de resultados, comparador S0/S1/S2 y evidencias.
- Verificación. Ejecutar [CT006-03](tests.md#ct006-03) y guardar evidencia de [AC006-03](acceptance.md#ac006-03).
- Estado. Jira development 3.7.0 verificó la comparación de referencia, el bloqueo de diferencias emparejadas al cambiar la semilla y las tablas de percentiles, objetivos, hitos y sensibilidad.

### T006-04 · Handoff a Agent X

- Dependencia. Revisar salida de `T006-03`.
- Entrega. Agregar entrada accesible y guía o enlace verificados. Mantener lectura por permiso en servidor.
- Verificación. Ejecutar [CT006-04](tests.md#ct006-04) y guardar evidencia de [AC006-04](acceptance.md#ac006-04).
- Estado. Rovo Chat en Jira development 3.7.0 citó la evidencia publicada y devolvió indisponibilidad para un UUID inexistente y para una corrida de staging. Queda pendiente repetir el caso con una segunda cuenta restringida.

[Plan](plan.md) · [Plantilla de tarea](../../docs/templates/TASK.md).
