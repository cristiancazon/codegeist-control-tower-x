# Control Tower X · Codegeist submission draft

## Product description

Control Tower X is a Jira app for project controls in energy megaprojects. It connects a delayed shipment to the affected lifting equipment, contractor, installation and commissioning work. The Patagonia Energy Development demonstration uses synthetic data and Jira work items on a dedicated test project.

Futuros compares a baseline, a supply delay and an alternate supply scenario under shared assumptions. Published simulations include the snapshot, model, result hash, schedule and cost percentiles. Agent X explains those results and cites permitted evidence from the current Jira session. Decisiones lets a planner submit a corrective action tied to a published run. A different person reviews the frozen revision. The planner then confirms the creation of a Jira work item, with an audit trail and reconciliation for uncertain responses.

Suggested category **Apps for Specialized Industries**. Suggested bonus **Best Agents**, subject to the verified Agent X demonstration.

## Judge testing instructions

1. Use the authorized installation link on the designated Jira test site. A site administrator installs Control Tower X. Open project **PED** and select **Control Tower X**. Confirm the fixture cut and Jira and Rovo availability in **Estado de la instalación**.
2. Open **Vista general** and expand **Demora del suministro A-17**. Follow the links through PED-48, PED-64 and PED-83. Check that equipment, contractor and shipment references appear in the impact chain.
3. Open **Futuros** and compare S0, S1 and S2 from the same snapshot with the same seed and sample count. Inspect the cost and schedule metrics and their uncertainty. Use **Consultar a Agent X** to explain the evidence and open a cited result.
4. As the planner, open the published S2 run and choose **Preparar propuesta**. Review the generated draft and submit it. Share the exact proposal link with the designated reviewer. The reviewer opens it in a separate Jira session, checks the revision, and records a reason with an approval.
5. Return to the proposal as the planner. Choose **Preparar creación en Jira** and confirm the creation. Open the verified Jira issue from the proposal and compare its summary, evidence and activity. A proposal awaiting a different reviewer displays its pending status.

## Demo recording plan

| Time | Show |
| --- | --- |
| 0:00–0:38 | Explain the planning problem and open the live Overview. |
| 0:38–1:20 | Expand A-17 and show the affected work and equipment. |
| 1:20–2:26 | Compare S0, S1 and S2. Show the result cut and uncertainty. |
| 2:26–3:08 | Ask Agent X for an evidence-backed explanation and open a cited run. |
| 3:08–4:25 | Submit a proposal, approve from the distinct Jira session, then confirm creation as the planner. |
| 4:25–4:48 | Open the Jira work item and trace it to the proposal and Futuros run. |

## Submission fields to verify before publishing

- The Jira installation link works from an independent administrator session.
- The public YouTube recording runs under five minutes and matches the installed build.
- The English description and testing instructions match the final recorded workflow.
- The tested version, commit, roles, decision reference and Jira issue reference are linked to the evidence register.
- The owner checks eligibility, permissions and the final portal confirmation. [Official rules](https://codegeist2026.devpost.com/rules).
