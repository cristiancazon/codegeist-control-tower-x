# SDD-006 · Interfaz Futuros · plan técnico

## Dependencias

SDD-005. Consumir errores, valores de estado y resultados documentados en los contratos del motor.

## Capas y decisiones

### R006-01 · Editor versionado

El formulario usa schema compartido. Servidor valida permiso, revisión y unidades, y conserva una versión inmutable para la corrida.

### R006-02 · Estado de corrida

Hacer el polling con intervalo y backoff del contrato de §5. Aplicar control de doble clic, filtro por actor/proyecto y saneamiento de errores.

### R006-03 · Resultados y comparación

Construir tabla accesible y gráfico coherente con la salida agregada. Para comparación emparejada, exigir la compatibilidad de §5.

### R006-04 · Handoff a Agent X

Mostrar referencias a proyecto y corrida con procedimiento compatible con la superficie oficial. Aplicar fallback de abrir Rovo y proporcionar prompt si el puente no está habilitado en ese módulo.

## Evidencia por entorno

- Local. Probar flujos y validaciones de UI con DTO validados. Ejecutar prueba de concurrencia de ediciones y accesibilidad.
- Entorno real. Usar instalación Forge con al menos un VIEWER y un PLANNER y datos de A-17.

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
