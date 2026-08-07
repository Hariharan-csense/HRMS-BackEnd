const express = require("express");
const {
  createLoanRequest,
  getLoanRequests,
  updateLoanStatus,
  addLoanRepayment,
} = require("../controllers/loanController");
const { protect } = require("../middleware/authMiddleware");
const {
  requirePermission,
  requireAnyPermission,
} = require("../middleware/rbacMiddleware");

const router = express.Router();

router
  .route("/")
  .get(
    protect,
    requirePermission("payroll", "view", { submodule: "loans" }),
    getLoanRequests,
  )
  .post(
    protect,
    requirePermission("payroll", "create", { submodule: "loans" }),
    createLoanRequest,
  );

router.put(
  "/:id/status",
  protect,
  requireAnyPermission([
    { module: "payroll", submodule: "loans", action: "approve" },
    { module: "payroll", submodule: "loans", action: "update" },
  ]),
  updateLoanStatus,
);

router.post(
  "/:id/repayments",
  protect,
  requirePermission("payroll", "create", { submodule: "loans" }),
  addLoanRepayment,
);

module.exports = router;
