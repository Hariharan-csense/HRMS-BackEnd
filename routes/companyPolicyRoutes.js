const express = require("express");
const { getPolicy, updatePolicy } = require("../controllers/companyPolicyController");
const { protect } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/rbacMiddleware");

const router = express.Router();

router.get(
  "/",
  protect,
  requirePermission("organization", "view"),
  getPolicy,
);

router.put(
  "/",
  protect,
  requirePermission("organization", "update"),
  updatePolicy,
);

module.exports = router;
