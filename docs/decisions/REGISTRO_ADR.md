# Registro de decisiones arquitectónicas

| ADR | Estado | Decisión y consecuencia | Verificación |
|---|---|---|---|
| ADR-001 | Aprobada a nivel de diseño | Forge hospedado y Custom UI en proyecto Jira. Validar distribución y scopes en sitio real | SDD-001 / AC001-05 |
| ADR-002 | Aprobada a nivel de diseño | Futuros calcula en TypeScript con snapshot congelado, semilla y resultados versionados. El benchmark determina el lote y capacidad de demo | SDD-005 / AC005-04 y AC005-06 |
| ADR-003 | Aprobada a nivel de diseño | Acciones Rovo de lectura. El flujo humano de Jira revalida identidad, estado y permiso y registra incertidumbre de entrega | SDD-007 / AC007-02 y SDD-009 / AC009-03, AC009-04 |
| ADR-004 | Sujeta a pruebas en sitio | Accesos opcionales por instalación. Mostrar procedencia alternativa o funcionalidad deshabilitada cuando corresponda | SDD-008 / AC008-01 a AC008-04 |

Para cada nueva ADR, registrar fecha, estado, contexto, decisión, alternativas evaluadas, consecuencias, mitigaciones, condición para revisarla, fuentes oficiales y criterios SDD afectados. Enlazar el registro desde el spec que adopta la decisión.
