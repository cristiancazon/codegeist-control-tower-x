# SDD-002 · Datos y fixtures

## Resultado

Crear el modelo relacional Forge y un seed determinista de Patagonia Energy Development con procedencia, sincronización y protección de cambios.

## Requisitos

- **R002-01 · Migraciones y constraints**. El modelo persiste las entidades del plan y sus relaciones con restricciones verificables.

- **R002-02 · Canon y adaptadores**. El origen de cada dato queda identificado y el sync tolera páginas repetidas y eliminaciones acordadas.

- **R002-03 · Fixture Patagonia**. El generador reproduce volumen, dependencias, fases, costes, históricos y escenarios declarados en §7.

- **R002-04 · Bootstrap protegido**. Una instalación fresca puede cargar fixtures sin duplicar ni modificar otros proyectos.

- **R002-05 · Aislamiento y retención**. Repositorios filtran por instalación y proyecto, y aplican la política de retención vigente.

## Límites del incremento

- El canon Jira, sus ACL y datos sensibles se rigen por §6.
- El seed crea sólo datos ficticios en un proyecto explícitamente habilitado.

## Fuente y navegación

[Plan maestro](../../CONTROL_TOWER_X_MASTER_PLAN.md), §§6, 7, 8, 9 y 13. [Diseño](plan.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md) · [Pruebas](tests.md).
