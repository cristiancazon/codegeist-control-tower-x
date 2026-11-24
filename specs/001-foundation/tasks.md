# SDD-001 · Fundaciones · tareas

Cada tarea entrega código y evidencia en la etapa de implementación. Mantener las tareas pendientes hasta demostrar los criterios.

### T001-01 · Inventario de capacidades

- Dependencia. Dependencias declaradas del spec.
- Entrega. Crear inventario y registrar prerequisitos para reservar el sitio de humo.
- Verificación. Ejecutar [CT001-01](tests.md#ct001-01) y guardar evidencia de [AC001-01](acceptance.md#ac001-01).
- Estado. Inventario y versiones verificados localmente. Sitio de ensayo pendiente de confirmar.

### T001-02 · Base tipada y build reproducible

- Dependencia. Revisar salida de `T001-01`.
- Entrega. Generar esqueleto, lockfile y scripts de lint, types, test y build.
- Verificación. Ejecutar [CT001-02](tests.md#ct001-02) y guardar evidencia de [AC001-02](acceptance.md#ac001-02).
- Estado. Base de React y TypeScript construida desde dependencias fijadas. Lint de Forge pendiente de registro.

### T001-03 · Contexto confiable

- Dependencia. Revisar salida de `T001-02`.
- Entrega. Implementar el resolver mínimo y el tratamiento de acceso denegado, listo para ACL del dominio.
- Verificación. Ejecutar [CT001-03](tests.md#ct001-03) y guardar evidencia de [AC001-03](acceptance.md#ac001-03).
- Estado. Resolver implementado y probado con respuestas simuladas de permisos Jira. Prueba en development pendiente.

### T001-04 · Registro seguro y observabilidad

- Dependencia. Revisar salida de `T001-03`.
- Entrega. Agregar test de error propagado, política de registro y revisión automatizable de secretos.
- Verificación. Ejecutar [CT001-04](tests.md#ct001-04) y guardar evidencia de [AC001-04](acceptance.md#ac001-04).
- Estado. Correlación y saneamiento verificados por pruebas unitarias. Logs de development pendientes.

### T001-05 · Humo Jira development

- Dependencia. Revisar salida de `T001-04`.
- Entrega. Ejecutar `forge lint`, build y los pasos oficiales de despliegue e instalación development. Guardar evidencia.
- Verificación. Ejecutar [CT001-05](tests.md#ct001-05) y guardar evidencia de [AC001-05](acceptance.md#ac001-05).
- Estado. Pendiente de confirmar autenticación Forge, registrar la app y verificar Jira development.

[Plan](plan.md) · [Plantilla de tarea](../../docs/templates/TASK.md).
