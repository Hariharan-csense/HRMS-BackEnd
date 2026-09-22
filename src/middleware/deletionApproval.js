const { createDraft } = require("../services/deletionDrafts");

const deletionError = (res, error) => {
  console.error("Deletion workflow:", error.code || error.message);
  return res.status(error.status || 500).json({ success: false,
    message: error.status ? error.message : "Unable to complete deletion workflow. No changes were committed." });
};

const requestDeletion = (entity, options = {}) => async (req, res) => {
  try {
    const id = options.company ? req.user.company_id : req.params[options.param || "id"];
    if (id == null) return res.status(400).json({ message: "Record ID is required" });
    const result = await createDraft(req.user, entity, id, req.body?.reason);
    return res.status(202).json({ success: true, pendingDeletion: true, requestId: result.id,
      message: result.duplicate ? "Deletion is already awaiting CEO approval. The record is still active." : "Deletion request saved in Deletion Drafts. The record remains active until CEO approval." });
  } catch (error) { return deletionError(res, error); }
};

module.exports = { requestDeletion, deletionError };
