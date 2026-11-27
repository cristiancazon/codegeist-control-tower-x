# SDD-008 · Integraciones y capacidades · tareas

Cada tarea entrega código y evidencia en la etapa de implementación. Mantener las tareas pendientes hasta demostrar los criterios.

### T008-01 · Matriz de habilitación

- Dependencia. Dependencias declaradas del spec.
- Entrega. Crear inventario y puntos de control de configuración y experiencia de fallos.
- Verificación. Ejecutar [CT008-01](tests.md#ct008-01) y guardar evidencia de [AC008-01](acceptance.md#ac008-01).
- Estado. Implementada. Verificada en PED development con la sesión actual. La variante Jira sin Rovo está cubierta por la prueba local y sigue pendiente en un sitio real.

### T008-02 · Fuentes opcionales

- Dependencia. Revisar salida de `T008-01`.
- Entrega. Agregar adaptadores elegibles y pruebas de permisos, instalación y desconexión de cada fuente.
- Verificación. Ejecutar [CT008-02](tests.md#ct008-02) y guardar evidencia de [AC008-02](acceptance.md#ac008-02).
- Estado. Adaptadores y pruebas locales implementados. Los conectores permanecen deshabilitados en el perfil base. La verificación positiva y la revocación en las fuentes reales quedan pendientes del perfil opcional.

### T008-03 · MCP

- Dependencia. Revisar salida de `T008-02`.
- Entrega. Preparar prueba mínima reproducible y ficha pública solo tras verificar elegibilidad.
- Verificación. Ejecutar [CT008-03](tests.md#ct008-03) y guardar evidencia de [AC008-03](acceptance.md#ac008-03).
- Estado. Operación candidata y requisitos documentados. Módulo y exposición externa deshabilitados. Pendiente de habilitación y de prueba en un cliente elegible.

### T008-04 · Teamwork Graph y otras opciones Rovo

- Dependencia. Revisar salida de `T008-03`.
- Entrega. Documentar el camino implementable, prueba mínima y decisión de elegibilidad por opción.
- Verificación. Ejecutar [CT008-04](tests.md#ct008-04) y guardar evidencia de [AC008-04](acceptance.md#ac008-04).
- Estado. Consulta curada y requisitos documentados. Graph y Skills deshabilitados. Validación en sitio pendiente de los permisos, la relación de prueba y la habilitación correspondientes.

[Plan](plan.md) · [Plantilla de tarea](../../docs/templates/TASK.md).
