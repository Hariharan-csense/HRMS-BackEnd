const router = require("express").Router();
const db = require("../db/db");
const { protect } = require("../middleware/authMiddleware");
const { capabilities, actOnDraft } = require("../services/deletionDrafts");
const { deletionError } = require("../middleware/deletionApproval");
router.use(protect);
router.get("/", async (req, res) => {
  try {
    const caps = await capabilities(req.user);
    if (!caps.admin && !caps.ceo)
      return res.status(403).json({ message: "Admin or CEO access required" });
    const query = db("deletion_drafts");
    if (!caps.superadmin)
      query.where({ company_id: req.user.company_id || null });
    if (req.query.status && req.query.status !== "all")
      query.where("status", req.query.status);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const count = await query.clone().count({ total: "*" }).first();
    const data = await query
      .select(
        "id",
        "company_id",
        "entity",
        "record_id",
        "record_code",
        "record_label",
        "status",
        "summary",
        "reason",
        "requested_by_name",
        "reviewed_by_name",
        "review_note",
        "reviewed_at",
        "restored_by_name",
        "restored_at",
        "created_at",
      )
      .orderBy("id", "desc")
      .limit(50)
      .offset((page - 1) * 50);
    const employeeIds = data
      .filter((row) => row.entity === "employee" && !row.record_code)
      .map((row) => row.record_id);
    const employeeCodes = employeeIds.length
      ? Object.fromEntries(
          (
            await db("employees")
              .whereIn("id", employeeIds)
              .select("id", "employee_id")
          ).map((employee) => [String(employee.id), employee.employee_id]),
        )
      : {};
    res.json({
      success: true,
      data: data.map((row) => ({
        ...row,
        employee_code:
          row.entity === "employee"
            ? row.record_code || employeeCodes[String(row.record_id)] || null
            : null,
        summary:
          typeof row.summary === "string"
            ? JSON.parse(row.summary)
            : row.summary,
      })),
      total: Number(count.total),
      page,
      canApprove: caps.ceo,
      canRestore: caps.admin,
    });
  } catch (error) {
    deletionError(res, error);
  }
});
router.post("/:id/:action", async (req, res) => {
  try {
    res.json({
      success: true,
      ...(await actOnDraft(
        req.user,
        req.params.id,
        req.params.action,
        req.body?.note,
      )),
    });
  } catch (error) {
    deletionError(res, error);
  }
});
module.exports = router;
