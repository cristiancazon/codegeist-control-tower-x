# SDD-002 · Datos y fixtures · tareas

Cada tarea entrega código y evidencia en la etapa de implementación. Mantener las tareas pendientes hasta demostrar los criterios.

### T002-01 · Migraciones y constraints

- Dependencia. Dependencias declaradas del spec.
- Entrega. Crear migraciones, repositorios parametrizados y catálogo de índices.
- Verificación. Ejecutar [CT002-01](tests.md#ct002-01) y guardar evidencia de [AC002-01](acceptance.md#ac002-01).
- Estado. Migración Forge development lista y reanudación verificada localmente. [Evidencia](tests.md#evidencia-en-development-del-25-de-noviembre-de-2026).

### T002-02 · Canon y adaptadores

- Dependencia. Revisar salida de `T002-01`.
- Entrega. Agregar adaptador paginado, normalizador y checkpoint por ámbito.
- Verificación. Ejecutar [CT002-02](tests.md#ct002-02) y guardar evidencia de [AC002-02](acceptance.md#ac002-02).
- Estado. Adaptador y checkpoint probados localmente. Lectura por usuario activo y conciliación de la carga comprobadas en PED. Queda verificar la actualización de proyecciones.

### T002-03 · Fixture Patagonia

- Dependencia. Revisar salida de `T002-02`.
- Entrega. Crear generador unit-testable, manifiesto con claves y validadores de integridad.
- Verificación. Ejecutar [CT002-03](tests.md#ct002-03) y guardar evidencia de [AC002-03](acceptance.md#ac002-03).
- Estado. Verificado localmente el 25 de noviembre de 2026. [Evidencia](tests.md#evidencia-local-del-25-de-noviembre-de-2026).

### T002-04 · Bootstrap protegido

- Dependencia. Revisar salida de `T002-03`.
- Entrega. Construir comando de preparación autorizado y respaldo de operación registrado.
- Verificación. Ejecutar [CT002-04](tests.md#ct002-04) y guardar evidencia de [AC002-04](acceptance.md#ac002-04).
- Estado. Carga y reanudación verificadas en PED. Queda el ensayo con otro proyecto de control. [Evidencia](tests.md#evidencia-en-development-del-25-de-noviembre-de-2026).

### T002-05 · Aislamiento y retención

- Dependencia. Revisar salida de `T002-04`.
- Entrega. Agregar reglas de acceso, limpieza y pruebas de dos instalaciones.
- Verificación. Ejecutar [CT002-05](tests.md#ct002-05) y guardar evidencia de [AC002-05](acceptance.md#ac002-05).
- Estado. Revocación, vencimiento y limpieza de borradores sintéticos verificados localmente. Quedan la purga general y el ensayo con dos instalaciones reales.

[Plan](plan.md) · [Plantilla de tarea](../../docs/templates/TASK.md).
