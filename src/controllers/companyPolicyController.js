const {
  getCompanyPolicy,
  saveCompanyPolicy,
} = require("../services/companyPolicyService");

const getPolicy = async (req, res) => {
  const companyId = req.user?.company_id;
  if (!companyId) {
    return res.status(400).json({ message: "You are not assigned to any company" });
  }

  try {
    const policy = await getCompanyPolicy(companyId);
    return res.json({ success: true, policy });
  } catch (error) {
    console.error("Get company policy error:", error);
    return res.status(500).json({ message: "Failed to load company policy" });
  }
};

const updatePolicy = async (req, res) => {
  const companyId = req.user?.company_id;
  if (!companyId) {
    return res.status(400).json({ message: "You are not assigned to any company" });
  }

  try {
    const policy = await saveCompanyPolicy(companyId, req.body || {});
    return res.json({
      success: true,
      message: "Company policy saved successfully",
      policy,
    });
  } catch (error) {
    console.error("Update company policy error:", error);
    return res.status(500).json({ message: "Failed to save company policy" });
  }
};

module.exports = {
  getPolicy,
  updatePolicy,
};
