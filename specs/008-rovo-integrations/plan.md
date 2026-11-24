# SDD-008 · Integraciones y capacidades · plan técnico

## Dependencias

SDD-007 para handoff y autenticación. Cada integración requiere acceso, documentación, permisos y revisión del uso elegible.

## Capas y decisiones

### R008-01 · Matriz de habilitación

Registrar estado documentado, plan, región cuando aplique, compatibilidad, permisos y prueba mínima. Por defecto, las opciones esperan comprobación.

### R008-02 · Fuentes opcionales

Validar `app.compatibility` para Jira requerido y Confluence opcional en el mismo sitio. Aplicar documentación de JSM y Assets a endpoints y scopes efectivamente usados.

### R008-03 · MCP

Usar arquitectura, cliente, autenticación y superficie que aprueben las fuentes de §3 y las bases. Aplicar lectura permitida y rastreo de evidencia.

### R008-04 · Teamwork Graph y otras opciones Rovo

Distinguir API, conector, capacidad presentada por Rovo y función Preview. Liberar una opción solo con configuración, aislamiento y fallback demostrados.

## Evidencia por entorno

- Local. Ejecutar pruebas de matrices de capacidad, valores deshabilitados, mapeo de errores y filtrado de procedencia.
- Entorno real. Probar individualmente cada opción con una cuenta autorizada según el requisito oficial. Registrar entorno y estado real.

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
