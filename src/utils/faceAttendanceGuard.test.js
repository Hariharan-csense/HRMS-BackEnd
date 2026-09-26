const test = require("node:test");
const assert = require("node:assert/strict");
const { assertVerifiedFaceIdentity } = require("./faceAttendanceGuard");

const employee = { id: 10, company_id: 51, status: "active" };
test("verified identity is accepted", () => {
  assert.equal(assertVerifiedFaceIdentity({ match: { verified: true, employee }, companyId: 51 }).id, 10);
});
for (const [name, match, code] of [
  ["unknown face", { verified: false, reason: "FACE_NOT_MATCHED" }, "FACE_NOT_MATCHED"],
  ["ambiguous face", { verified: false, reason: "AMBIGUOUS_MATCH" }, "AMBIGUOUS_MATCH"],
  ["multiple faces", { verified: false, reason: "MULTIPLE_FACES" }, "MULTIPLE_FACES"],
  ["service unavailable", { verified: false, reason: "SERVICE_UNAVAILABLE" }, "SERVICE_UNAVAILABLE"],
]) {
  test(name + " cannot reach attendance", () => {
    assert.throws(() => assertVerifiedFaceIdentity({ match, companyId: 51 }), (error) => error.code === code);
  });
}
test("company mismatch cannot reach attendance", () => {
  assert.throws(() => assertVerifiedFaceIdentity({ match: { verified: true, employee }, companyId: 52 }), /does not belong/);
});
test("inactive employee cannot reach attendance", () => {
  assert.throws(() => assertVerifiedFaceIdentity({ match: { verified: true, employee: { ...employee, status: "inactive" } }, companyId: 51 }), /not active/);
});
test("1:1 identity mismatch cannot reach attendance", () => {
  assert.throws(() => assertVerifiedFaceIdentity({ match: { verified: true, employee }, companyId: 51, expectedEmployeeId: 11 }), /signed-in employee/);
});

