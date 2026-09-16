// Explicit opt-in: fixtures live inside one transaction and are always rolled back.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const db = require("../db/db");
const service = require("./kpiHierarchyService");
after(() => db.destroy());

test(
  "MySQL hierarchy save, period/parameter isolation, permissions, and reporting changes",
  { skip: process.env.KPI_MYSQL_TEST !== "1" },
  async () => {
    const trx = await db.transaction();
    try {
      const unique = `kpi-test-${Date.now()}`;
      const company = async (suffix) =>
        (
          await trx("companies").insert({
            company_id: `${unique}${suffix}`,
            company_name: "KPI test",
            legal_name: "KPI test",
            gstin_pan: `${unique}${suffix}`,
          })
        )[0];
      const companyId = await company("a");
      const otherCompany = await company("b");
      const employee = async (
        name,
        manager_id = null,
        company_id = companyId,
      ) =>
        (
          await trx("employees").insert({
            company_id,
            first_name: name,
            last_name: "Test",
            role: "employee",
            manager_id,
          })
        )[0];
      const head = await employee("Head");
      const managerA = await employee("Manager A", head);
      const managerB = await employee("Manager B", head);
      const leafA = await employee("Leaf A", managerA);
      const leafB = await employee("Leaf B", managerA);
      const leafC = await employee("Leaf C", managerB);
      const foreign = await employee("Foreign", null, otherCompany);
      const [templateId] = await trx("kpi_templates").insert({
        company_id: companyId,
        owner_employee_id: leafA,
        title: "Hierarchy test",
      });
      const [parameterId] = await trx("kpi_parameters").insert({
        kpi_template_id: templateId,
        name: "Parameter A",
        achievement: 1,
        kpi_score: 80,
      });
      const [parameterB] = await trx("kpi_parameters").insert({
        kpi_template_id: templateId,
        name: "Parameter B",
      });
      const user = { company_id: companyId, role: "admin" };
      const ctx = { companyId, templateId, parameterId, year: 2030, month: 1 };
      const score = async (id, value) =>
        service.saveScore(user, ctx, id, value, trx);
      await score(leafA, 80);
      await score(leafB, 100);
      const saved = await score(leafC, 30);
      assert.equal(saved.tree[0].score, 60);
      assert.equal(saved.tree[0].children[0].score, 90);
      assert.equal(saved.tree[0].children[1].score, 30);
      assert.equal(
        (
          await service.calculateHierarchyScore(
            head,
            templateId,
            2030,
            1,
            companyId,
            parameterId,
            trx,
          )
        ).score,
        60,
      );
      assert.deepEqual(
        (
          await service.recalculateParentScores(
            leafA,
            templateId,
            2030,
            1,
            companyId,
            parameterId,
            trx,
          )
        ).map((n) => n.id),
        [managerA, head],
      );
      await assert.rejects(score(head, 99), /automatically/);
      await assert.rejects(score(foreign, 99), /not found/);
      await assert.rejects(score(leafA, ""), /valid number/);
      await assert.rejects(
        service.setParent(user, ctx, head, leafA, trx),
        /cycle/,
      );
      await assert.rejects(
        service.setParent(user, ctx, leafA, foreign, trx),
        /same company/,
      );
      const self = {
        company_id: companyId,
        role: "employee",
        employee_id: leafA,
      };
      await assert.rejects(
        service.saveScore(self, ctx, leafB, 50, trx),
        /Access denied/,
      );
      const selfResult = await service.saveScore(self, ctx, leafA, 60, trx);
      assert.equal(selfResult.tree.length, 1);
      assert.equal(selfResult.tree[0].id, leafA);
      assert.equal(selfResult.tree[0].score, 60);
      await score(leafB, null);
      assert.equal((await service.load(trx, ctx)).nodes.get(head).score, 45);
      assert.equal(
        (await service.load(trx, { ...ctx, month: 2 })).nodes.get(head).score,
        null,
      );
      assert.equal(
        (
          await service.load(trx, { ...ctx, parameterId: parameterB })
        ).nodes.get(head).score,
        null,
      );
      await service.saveScore(
        user,
        { ...ctx, parameterId: parameterB },
        leafA,
        10,
        trx,
      );
      assert.equal(
        (await service.load(trx, { ...ctx, parameterId: null })).nodes.get(
          leafA,
        ).score,
        70,
      );
      await service.setParent(user, ctx, leafC, managerA, trx);
      assert.equal(
        (await service.load(trx, ctx)).nodes.get(managerA).score,
        45,
      );
      const now = new Date();
      const legacyCtx = {
        ...ctx,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
      };
      assert.equal(
        (await service.load(trx, legacyCtx)).nodes.get(leafA).score,
        80,
      );
      await assert.rejects(service.saveScore(user, legacyCtx, leafA, null, trx), /original scorecard/);
      await trx('kpi_hierarchy_scores').insert({ company_id: companyId, employee_id: leafA,
        kpi_template_id: templateId, kpi_parameter_id: parameterId,
        year: legacyCtx.year, month: legacyCtx.month, score: 5 });
      assert.equal(
        (await service.load(trx, legacyCtx)).nodes.get(leafA).score,
        80,
      );
      await trx('kpi_parameters').where({ id: parameterId }).update({ achievement: 2, kpi_score: 95 });
      const changed = await service.load(trx, legacyCtx);
      assert.equal(changed.nodes.get(leafA).score, 95);
      assert.equal(changed.nodes.get(leafA).scoreSource, 'scorecard');
      assert.equal(changed.nodes.get(head).score, 95);
      await assert.rejects(
        service.load(trx, { ...ctx, companyId: otherCompany }),
        /not found/,
      );
      await assert.rejects(
        service.load(trx, { ...ctx, parameterId: 2147483647 }),
        /does not belong/,
      );
    } finally {
      await trx.rollback();
    }
  },
);
