const service = require("../services/esslService");
const sync = require("../services/esslSyncService");
const { tenant, safeError } = require("../utils/esslUtils");
const handle = (operation, status = 200) => async (req, res) => {
  try {
    const data = await operation(tenant(req.user?.company_id), req);
    return res.status(status).json({ success: data?.status !== "FAILED", data });
  } catch (error) {
    const statusCode = error.esslSafe ? error.status : error.code === "ER_DUP_ENTRY" ? 409 : 500;
    if (statusCode === 500) console.error("eSSL request failed:", safeError(error));
    return res.status(statusCode).json({ success: false, message: safeError(error) });
  }
};
module.exports = {
  listDevices: handle((company) => service.listDevices(company)),
  createDevice: handle((company, req) => service.createDevice(company, req.body), 201),
  getDevice: handle((company, req) => service.getDevice(company, req.params.id)),
  updateDevice: handle((company, req) => service.updateDevice(company, req.params.id, req.body)),
  disableDevice: handle((company, req) => service.disableDevice(company, req.params.id)),
  status: handle((company, req) => service.getStatus(company, req.params.id)),
  testConnection: handle((company, req) => service.testConnection(company, req.params.id)),
  syncDevice: handle((company, req) => sync.syncDevice(company, req.params.id)),
  logs: handle((company, req) => service.listLogs(company, req.query, req.params.id)),
  syncLogs: handle((company, req) => service.listSyncLogs(company, req.query)),
  listMappings: handle((company) => service.listMappings(company)),
  createMapping: handle((company, req) => service.saveMapping(company, null, req.body), 201),
  updateMapping: handle((company, req) => service.saveMapping(company, req.params.id, req.body)),
  disableMapping: handle((company, req) => service.disableMapping(company, req.params.id)),
  employees: handle((company, req) => service.employees(company, req.query)),
};

