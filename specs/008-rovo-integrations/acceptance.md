# SDD-008 · Integraciones y capacidades · aceptación

Deben aprobarse todos los criterios aplicables. El resultado por entorno se registra con revisión, hora, credencial identificada por rol y evidencia saneada.

### AC008-01

**Matriz de habilitación / R008-01.** Cada opción habilitada tiene prueba de permiso y lectura exitosa. Una opción bloqueada se explica y conserva el recorrido disponible. Evidencia en `CT008-01`.

### AC008-02

**Fuentes opcionales / R008-02.** Cada lectura devuelve procedencia. La opción deshabilitada o revocada no entrega un resultado engañoso. Evidencia en `CT008-02`.

### AC008-03

**MCP / R008-03.** El caso corresponde a integración MCP real y sus permisos se validan. Si falta habilitación, se registra pendiente. Evidencia en `CT008-03`.

### AC008-04

**Teamwork Graph y otras opciones Rovo / R008-04.** Puede identificarse la operación oficial utilizada, su resultado y el límite del sitio sin afectar el recorrido core. Evidencia en `CT008-04`.

[Requisitos](spec.md) · [Casos](tests.md).
