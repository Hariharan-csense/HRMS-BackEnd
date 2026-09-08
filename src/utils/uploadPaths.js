const path = require("path");
const fs = require("fs");

const isBackendRoot = (dir) => {
  try {
    const packageJsonPath = path.join(dir, "package.json");
    if (!fs.existsSync(packageJsonPath)) return false;

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return packageJson.name === "backend";
  } catch {
    return false;
  }
};

const resolveUploadRoot = () => {
  if (process.env.UPLOAD_ROOT) {
    return path.resolve(process.env.UPLOAD_ROOT);
  }

  const cwd = process.cwd();

  if (fs.existsSync(path.join(cwd, "backend", "package.json"))) {
    return path.resolve(cwd, "uploads");
  }

  if (isBackendRoot(cwd)) {
    return path.resolve(cwd, "..", "uploads");
  }

  if (path.basename(cwd).toLowerCase() === "dist" && isBackendRoot(path.dirname(cwd))) {
    return path.resolve(cwd, "..", "..", "uploads");
  }

  return path.resolve(cwd, "uploads");
};

const uploadRoot = resolveUploadRoot();

const resolveUploadPath = (...segments) => path.join(uploadRoot, ...segments);

module.exports = {
  uploadRoot,
  resolveUploadPath,
};
