# SDD-002 · Datos y fixtures · plan técnico

## Dependencias

SDD-001. Sitio aislado, proyecto destino confirmado y autorización de bootstrap para las escrituras de fixtures.

## Capas y decisiones

### R002-01 · Migraciones y constraints

Aplicar migraciones ordenadas por instalación. Probar soporte SQL real de los DDL y documentar invariantes que exigen guardas del dominio.

### R002-02 · Canon y adaptadores

Modelar identificadores remotos, timestamp de origen y cursor. Consumir Jira con identidad de usuario y propagar fuente inaccesible como estado explícito.

### R002-03 · Fixture Patagonia

Timestamp de corte, semilla y versión fijos. Construir DAG válido y plantar A-17 con referencias coherentes en Jira y Forge.

### R002-04 · Bootstrap protegido

Mostrar destino, volumen y consecuencias antes de confirmar. Exigir ADMIN, acceso Jira y proyecto dedicado. Guardar manifiesto de progreso y reconciliar tras respuestas perdidas.

### R002-05 · Aislamiento y retención

Separar namespace de caché. Conservar referencias necesarias para evidencia y purgar según clase y contrato.

## Evidencia por entorno

- Local. Ejecutar corpus reproducible, validaciones, comprobación de grafo, pruebas de repositorios y simulación de interrupciones.
- Entorno real. Aplicar migraciones y seed por una cuenta ADMIN autorizada. Confirmar lecturas Jira por usuario y smoke de la segunda instalación.

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
