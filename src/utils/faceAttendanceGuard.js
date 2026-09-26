const reject = (code, message, statusCode = 400) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
};

const assertVerifiedFaceIdentity = ({ match, companyId, expectedEmployeeId = null }) => {
  if (!match || match.verified !== true) {
    reject(match?.reason || "FACE_NOT_MATCHED", "Face identity was not verified");
  }
  const employee = match.employee;
  if (!employee || Number(employee.company_id) !== Number(companyId)) {
    reject("TENANT_ISOLATION_FAILURE", "Verified employee does not belong to this company", 403);
  }
  if (expectedEmployeeId !== null && Number(employee.id) !== Number(expectedEmployeeId)) {
    reject("FACE_NOT_MATCHED", "Face does not match the signed-in employee");
  }
  if (String(employee.status || "active").trim().toLowerCase() !== "active") {
    reject("INACTIVE_EMPLOYEE", "Employee is not active", 403);
  }
  return employee;
};

module.exports = { assertVerifiedFaceIdentity };

