# KPI hierarchy

The KPI Scorecard page now includes a hierarchy section. Existing scorecards, review workflows, attachments, and reports retain their original behavior.

## Storage and calculation

- Reuses `employees.manager_id`, which exists in the inspected MySQL database. The existing column is signed and has no foreign key; this migration preserves it and its data. If absent on another installation, the migration creates it as an unsigned employee reference with `ON DELETE SET NULL`.
- Adds `kpi_hierarchy_scores` for manual, per-employee parameter scores. Its unique key is company + template + year + month + employee + parameter. Existing `employee_kpi` cannot represent parameter/period-specific entries without changing its semantics.
- A selected template is a shared measurement definition within its company. Select that same template for all employees being compared; separately created employee templates are not implicitly matched by name.
- Leaf scores are entered per parameter. All parameters sums available weighted parameter scores, matching the existing scorecard convention. Enter the resulting KPI parameter score, not its raw achievement value.
- Each parent averages only its direct children's available scores, at every level. Actual zero counts; missing scores do not. No available child scores returns `null`. No intermediate rounding occurs; the UI displays up to four decimals.
- Parents are derived on reads rather than stored. `scoreType` is `manual` for leaves and `auto_average` for parents. Existing manual values on an employee who becomes a manager are retained but ignored while that employee has direct reports. They become available again if the employee becomes a leaf.
- Achievement-based template-owner parameter scores are authoritative in the template's original year/month. They take precedence over separate hierarchy entries and display as "From scorecard". Change these scores by editing the original scorecard achievement. Creating or editing a scorecard automatically selects that template and period in the hierarchy and refreshes its scores. Parent averages remain derived from direct children. Manual hierarchy scores remain available where no achievement-based score exists.
- Reporting links to missing or foreign-company employees are not followed. Existing cycles return a clear conflict error rather than hanging. All employees, including inactive employees, remain in the reporting structure until their reporting relationships are updated.

## Permissions and concurrency

All endpoints require authentication and a company context. Tree responses preserve the existing self/department/organization KPI visibility rules. Parent averages are calculated from the complete same-company hierarchy before visibility is applied; hidden children do not change a manager's score type or average.

Template titles and parameter definitions are shared within the company for this hierarchy feature. Individual score visibility remains scoped. Score saves require KPI scorecard update permission and employee visibility. Parent assignment requires employee-profile update permission, KPI scorecard view permission, and organization-level visibility.

Score writes and reporting changes use transactions and the same company-row lock. Parent changes reject self, descendants, and managers from another company. Use the protected hierarchy endpoint for reporting updates; direct SQL writes bypass validation. The existing employee forms do not write `manager_id`.

## Migration and checks (PowerShell, from the HRMS root)

This migration was applied successfully to the configured local database during implementation. To apply this specific migration on another environment:

```powershell
Set-Location backend
npx.cmd knex migrate:up 20260916000001_create_kpi_hierarchy_scores.js
node --test src/services/kpiHierarchyTree.test.js
$env:KPI_MYSQL_TEST='1'
node --test src/services/kpiHierarchyService.integration.test.js
Remove-Item Env:KPI_MYSQL_TEST
Set-Location ../FrontEnd
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

The MySQL integration test creates isolated fixtures inside a transaction and always rolls it back. Run against a development/test database with the migration applied. Auto-increment sequences can advance despite rollback.

Restart the backend after migration (`npm.cmd run dev` in `backend`), then open KPI → Scorecard. Select a hierarchy template and period. An authorized organization user can set reporting managers in the tree. Select a parameter, enter leaf scores, and save. The response replaces the tree with updated parent averages. Blank clears a score. Use Refresh to pick up changes made in another session.

To verify direct-child averaging, create a Head with two managers. Under Manager A enter 80 and 100; under Manager B enter 30 for one employee. Manager A must show 90, Manager B 30, and Head **60**, not the all-descendant average of 70.

## API (relative to `/backend/api/kpi`)

| Method | Path | Input |
| --- | --- | --- |
| GET | `/hierarchy/templates` | No parameters |
| GET | `/hierarchy` | `templateId`, `year`, `month`, optional `parameterId` |
| PUT | `/hierarchy/:employeeId/score` | JSON: `templateId`, `year`, `month`, `parameterId`, `score` (number or null) |
| PUT | `/hierarchy/:employeeId/parent` | JSON: `templateId`, `year`, `month`, optional `parameterId`, `parentEmployeeId` (number or null) |

Hierarchy responses contain `{ tree: [...roots], parameters: [{ id, name }], canManageHierarchy }`. Each node contains `id`, `name`, `designation`, `department`, `branch`, `score`, `scoreType`, `parentEmployeeId`, and `children`. Multiple roots are supported without a synthetic employee. Validation errors use 400, access failures 403, missing records 404, and cycles/manual parent writes 409.

Reusable service exports: `calculateHierarchyScore(employeeId, templateId, year, month, companyId, parameterId?, trx?)` and `recalculateParentScores(...)`. The latter returns the ancestor chain with freshly calculated scores; it does not persist derived values.

## Changed files

- `backend/src/db/migrations/20260916000001_create_kpi_hierarchy_scores.js`
- `backend/src/services/kpiHierarchyTree.js`
- `backend/src/services/kpiHierarchyService.js`
- `backend/src/services/kpiHierarchyTree.test.js`
- `backend/src/services/kpiHierarchyService.integration.test.js`
- `backend/src/controllers/kpiHierarchyController.js`
- `backend/src/routes/kpiRoutes.js`
- `FrontEnd/client/components/kpi/KpiHierarchy.tsx`
- `FrontEnd/client/pages/KPIScoreboardPage.tsx`
- `backend/KPI_HIERARCHY.md`

Verification: 8 hierarchy unit tests, the opt-in MySQL integration test, 14 existing frontend tests, and the frontend client/server production build passed. The build reports bundle-size and mixed-import warnings. Repository-wide TypeScript checking currently fails in existing code (including role utilities and several pages); the new hierarchy component has no reported TypeScript errors. Interactive browser testing has not been performed.
