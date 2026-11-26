# SDD-007 · Agent X · tareas

Cada tarea entrega código y evidencia en la etapa de implementación. Mantener las tareas pendientes hasta demostrar los criterios.

### T007-01 · Registro y contexto Rovo

- Dependencia. Dependencias declaradas del spec.
- Entrega. Configurar manifiesto, prompt, mensajes iniciales y prueba de instalación autorizada.
- Verificación. Ejecutar [CT007-01](tests.md#ct007-01) y guardar evidencia de [AC007-01](acceptance.md#ac007-01).
- Estado. Verificada en Jira development con agente nativo, handoff desde A-17, selectores faltantes y proyecto fuera de alcance.

### T007-02 · Acciones de lectura

- Dependencia. Revisar salida de `T007-01`.
- Entrega. Implementar acciones y adaptadores de lectura para estado, cadena del riesgo y predicciones.
- Verificación. Ejecutar [CT007-02](tests.md#ct007-02) y guardar evidencia de [AC007-02](acceptance.md#ac007-02).
- Estado. Verificadas las cinco acciones de lectura en Jira. Los casos de rol revocado y errores transitorios pasaron en local. Queda pendiente la segunda cuenta de prueba en Jira.

### T007-03 · Respuesta con evidencia

- Dependencia. Revisar salida de `T007-02`.
- Entrega. Crear pruebas de fidelidad para las preguntas críticas y una solicitud de evaluación de S0, S1 y S2.
- Verificación. Ejecutar [CT007-03](tests.md#ct007-03) y guardar evidencia de [AC007-03](acceptance.md#ac007-03).
- Estado. Tres repeticiones conformes por caso de A-17, S1 publicada, corrida fallida y comparación emparejada. Se comprobó el rechazo de una comparación por semilla distinta.

### T007-04 · Inyección, errores y handoff

- Dependencia. Revisar salida de `T007-03`.
- Entrega. Agregar negativas de seguridad, mensajes de recuperación y handoff verificable.
- Verificación. Ejecutar [CT007-04](tests.md#ct007-04) y guardar evidencia de [AC007-04](acceptance.md#ac007-04).
- Estado. Verificados el handoff, el rechazo de proyecto ajeno y el tratamiento de texto hostil simulado en Rovo. La ausencia de Rovo se probó en local. Queda pendiente un sitio de prueba con Rovo deshabilitado.

[Plan](plan.md) · [Plantilla de tarea](../../docs/templates/TASK.md).
