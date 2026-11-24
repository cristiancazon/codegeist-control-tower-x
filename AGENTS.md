# AGENTS.md — Control Tower X

## Fuente de verdad y ejecución

- Lee `CONTROL_TOWER_X_MASTER_PLAN.md`, el README y los cinco documentos de la especificación activa antes de cambiar archivos. Confirma dependencias y evidencia. Respeta el orden SDD y documenta cualquier cambio acordado en alcance o contrato.
- Trabaja sobre una tarea verificable por vez. Vincula cada cambio a requisito, tarea, aceptación y prueba. Divide una tarea cuando supere un cambio fácilmente revisable. Mantén trazabilidad desde el dato hasta la predicción y la acción correctiva.
- Consulta documentación oficial vigente antes de declarar un módulo, scope, endpoint, plan o capacidad Atlassian. Anota URL, fecha, estado y la prueba del sitio cuando aplique. Las funciones opcionales requieren disponibilidad y autorización comprobadas antes de habilitarse.
- Usa identidad y contexto verificados por Forge. Aplica validación, pertenencia a proyecto y autorización en servidor. Preserva ACL de la fuente. Las acciones Rovo son de lectura. Una escritura correctiva exige autorización, aprobación humana, permisos Jira y reconciliación de entregas inciertas.
- Reserva las probabilidades, percentiles e intervalos al motor Futuros. Conserva semilla, versión, snapshot y métodos, y expón los límites de los datos. Usa fixtures sintéticas. Evita conexiones de control a SCADA o SIS.
- Mantén credenciales en el mecanismo local o de entorno administrado que corresponda. Evita imprimir, capturar, compartir o versionar secretos e información sensible. El repositorio documenta nombres y procedimientos seguros.
- Ejecuta pruebas pertinentes, revisa el diff y registra contexto, comando, versión, resultado y evidencia. Mantén pendientes los criterios sin verificación. Actualiza especificación, documentación y pruebas en el mismo cambio cuando se modifique el comportamiento.
- Registra decisiones técnicas con sus consecuencias en `docs/decisions/`. Respeta la autorización por entorno. Despliega a producción solamente con autorización explícita. Verifica que el sitio de prueba y la instalación sean los previstos antes de modificar datos.
