# SDD-007 · Agent X · plan técnico

## Dependencias

SDD-004, SDD-005, sitio Rovo y manifiesto documentado. El handoff de SDD-006 se integra cuando esté disponible.

## Capas y decisiones

### R007-01 · Registro y contexto Rovo

Confirmar módulos, versión y contexto del actor. Cuando falte identidad confiable, fallar de forma cerrada y describir la ruta en UI.

### R007-02 · Acciones de lectura

Usar un allowlist de acciones con payload validado. Lecturas de proveedores y resultados se limitan por permiso, fuente, profundidad y tamaño.

### R007-03 · Respuesta con evidencia

En el prompt exigir fecha, fuente y versión de modelo para resultados del motor. Una recomendación cualitativa distingue causales demostradas, supuestos y contrapartidas.

### R007-04 · Inyección, errores y handoff

Separar instrucciones, documentos y datos de usuarios. Señalar la UI autorizada para el flujo de decisión.

## Evidencia por entorno

- Local. Ejecutar pruebas de contrato de funciones, prompt de referencia, autorización, source filtering y salida tipada.
- Entorno real. Instalar módulos verificados y realizar cada consulta crítica como los perfiles elegibles y revocados.

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
