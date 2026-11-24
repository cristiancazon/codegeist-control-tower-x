# SDD-001 · Fundaciones · plan técnico

## Dependencias

Accesos obligatorios de §8 para el humo. La verificación local puede avanzar con los prerequisitos de instalación identificados.

## Capas y decisiones

### R001-01 · Inventario de capacidades

Revisar fuentes oficiales para `jira:projectPage`, Custom UI y resolver. Separar compatibilidad documentada, disponibilidad del sitio y permisos del actor.

### R001-02 · Base tipada y build reproducible

Crear aplicación Forge con el recurso estático de React. Configurar Node según soporte vigente y un build que produzca el directorio referenciado por el manifiesto.

### R001-03 · Contexto confiable

Usar la identidad del resolver en servidor. Los datos de puente en Custom UI son útiles para navegación. Payloads de cuenta y tenant se rechazan o se descartan al autorizar.

### R001-04 · Registro seguro y observabilidad

Registrar operación, duración y categoría de error. El cliente recibe un código tipado y referencia de soporte.

### R001-05 · Humo Jira development

Instalar la app registrada y previamente desplegada en el entorno acordado. Confirmar instalación en sitio y rol autorizado.

## Evidencia por entorno

- Local. Fijar CLI, Node y lockfile. Ejecutar lint, comprobación de tipos, test y build sin secretos.
- Entorno real. Usar una instalación Jira de development con usuario autorizado, una segunda cuenta de prueba y un proyecto conocido.

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
