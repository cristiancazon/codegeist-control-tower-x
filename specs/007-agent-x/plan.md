# SDD-007 · Agent X · plan técnico

## Dependencias

SDD-004, SDD-005, sitio Rovo y manifiesto documentado. El handoff de SDD-006 se integra cuando esté disponible.

## Capas y decisiones

### R007-01 · Registro y contexto Rovo

Registrar el agente nativo con el prompt en static/agent/prompts/agent-x.txt y mantener la clave usada por Futuros. Las acciones toman la identidad del segundo argumento de Forge y usan la referencia de proyecto solo como selector. Una identidad ausente o contradictoria recibe un estado de autenticación. [Contexto de las acciones](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/) · [Registro del agente](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/).

### R007-02 · Acciones de lectura

Registrar cinco acciones GET para estado, exposición, conocimiento, resultado y comparación. Reutilizar las comprobaciones de permisos de Jira y del proyecto desde Overview, las vistas operativas y Futuros. La referencia acepta ID numérico Jira, clave PED o el UUID exacto del proyecto demo configurado. Confluence informa el estado deshabilitado y el catálogo local conserva su etiqueta sintética. Los resultados de Futuros requieren visibilidad del snapshot completo.

### R007-03 · Respuesta con evidencia

Exigir corte, fuente y versión del modelo al citar resultados del motor. La cadena A-17 devuelve enlaces a los ítems Jira autorizados y separa la señal ETA del supuesto de S1. La comparación distingue el delta entre dos cuantiles P80 marginales de la distribución de diferencias muestra a muestra.

### R007-04 · Inyección, errores y handoff

Seleccionar los campos declarados e ignorar los metadatos del payload como fuente de identidad. Proyectar referencias acotadas y omitir texto Jira que el agente no necesita. Desde Vista general, el enlace de A-17 verifica el acceso del usuario y ofrece apertura nativa o consulta copiable. El borrador en chat es texto para revisión humana. [Bridge de Rovo para Jira](https://developer.atlassian.com/platform/forge/apis-reference/ui-api-bridge/rovo/).

## Evidencia por entorno

- Local. Ejecutar pruebas de contrato de funciones, prompt de referencia, autorización, source filtering y salida tipada.
- Entorno real. Instalar módulos verificados y realizar cada consulta crítica como los perfiles elegibles y revocados.

[Requisitos](spec.md) · [Tareas](tasks.md) · [Aceptación](acceptance.md).
