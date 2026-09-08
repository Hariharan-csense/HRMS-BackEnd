const fs = require("fs");
const path = require("path");

const resolveTemplatePath = (filename) => {
  const candidates = [
    path.join(__dirname, "..", "templates", filename),
    path.join(process.cwd(), "src", "templates", filename),
    path.join(process.cwd(), "templates", filename),
    path.join(process.cwd(), "backend", "src", "templates", filename),
  ];

  const templatePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!templatePath) {
    throw new Error(`Mail template not found: ${filename}`);
  }

  return templatePath;
};

module.exports = { resolveTemplatePath };
