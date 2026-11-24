# SDD-001 · Fundaciones · tareas

Cada tarea entrega código y evidencia en la etapa de implementación. Mantener las tareas pendientes hasta demostrar los criterios.

### T001-01 · Inventario de capacidades

- Dependencia. Dependencias declaradas del spec.
- Entrega. Crear inventario y registrar prerequisitos para reservar el sitio de humo.
- Verificación. Ejecutar [CT001-01](tests.md#ct001-01) y guardar evidencia de [AC001-01](acceptance.md#ac001-01).
- Estado. Completada. Versiones verificadas y sitio Jira de ensayo confirmado.

### T001-02 · Base tipada y build reproducible

- Dependencia. Revisar salida de `T001-01`.
- Entrega. Generar esqueleto, lockfile y scripts de lint, types, test y build.
- Verificación. Ejecutar [CT001-02](tests.md#ct001-02) y guardar evidencia de [AC001-02](acceptance.md#ac001-02).
- Estado. Completada. Instalación desde lockfile, verificación local, lint de Forge y empaquetado para development verificados.

### T001-03 · Contexto confiable

- Dependencia. Revisar salida de `T001-02`.
- Entrega. Implementar el resolver mínimo y el tratamiento de acceso denegado, listo para ACL del dominio.
- Verificación. Ejecutar [CT001-03](tests.md#ct001-03) y guardar evidencia de [AC001-03](acceptance.md#ac001-03).
- Estado. Verificado localmente y mediante la sesión autorizada en Jira development. Queda el caso de una segunda identidad con acceso restringido.

### T001-04 · Registro seguro y observabilidad

- Dependencia. Revisar salida de `T001-03`.
- Entrega. Agregar test de error propagado, política de registro y revisión automatizable de secretos.
- Verificación. Ejecutar [CT001-04](tests.md#ct001-04) y guardar evidencia de [AC001-04](acceptance.md#ac001-04).
- Estado. Correlación y saneamiento verificados por pruebas unitarias. La ejecución autorizada aparece correlacionada en logs de development.

### T001-05 · Humo Jira development

- Dependencia. Revisar salida de `T001-04`.
- Entrega. Ejecutar `forge lint`, build y los pasos oficiales de despliegue e instalación development. Guardar evidencia.
- Verificación. Ejecutar [CT001-05](tests.md#ct001-05) y guardar evidencia de [AC001-05](acceptance.md#ac001-05).
- Estado. Desarrollo desplegado e instalado. Prueba autorizada exitosa en `PED`. El cierre requiere una segunda identidad sin acceso al proyecto.

[Plan](plan.md) · [Plantilla de tarea](../../docs/templates/TASK.md).
