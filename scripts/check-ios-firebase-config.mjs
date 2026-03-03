import fs from "node:fs";
import path from "node:path";

function resolveRepoRoot(startDir) {
  let current = path.resolve(startDir);

  while (true) {
    const hasIosDir = fs.existsSync(path.join(current, "ios", "mychampions.xcodeproj"));
    const hasPackageJson = fs.existsSync(path.join(current, "package.json"));
    if (hasIosDir && hasPackageJson) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

function normalizeEnvironment(rawEnv) {
  const value = (rawEnv ?? "").trim().toLowerCase();
  if (!value) return "dev";
  if (value === "prod" || value === "production") return "production";
  if (value === "dev") return "dev";
  throw new Error(`Unknown EXPO_PUBLIC_ENV: ${rawEnv} (expected dev|prod|production)`);
}

function relativeToRoot(root, absolutePath) {
  return path.relative(root, absolutePath) || ".";
}

function findFirstExistingFile(candidateDirs, candidateNames) {
  for (const dirPath of candidateDirs) {
    for (const fileName of candidateNames) {
      const filePath = path.join(dirPath, fileName);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
  }

  return null;
}

function main() {
  const root = resolveRepoRoot(process.cwd());
  const environment = normalizeEnvironment(process.env.EXPO_PUBLIC_ENV);

  const candidateDirs = [path.join(root, "ios", "mychampions"), path.join(root, "ios"), root];
  const candidateNames =
    environment === "production"
      ? ["GoogleService-Info.plist", "GoogleService-Info-Prod.plist"]
      : ["GoogleService-Info-Dev.plist", "GoogleService-Info.plist"];

  const foundFile = findFirstExistingFile(candidateDirs, candidateNames);

  if (!foundFile) {
    const lookedFor = candidateDirs
      .map((dirPath) => `- ${relativeToRoot(root, dirPath)}: ${candidateNames.join(", ")}`)
      .join("\n");

    console.error("iOS Firebase config check failed.\n");
    console.error(`Environment: ${environment}`);
    console.error("Missing GoogleService plist. Looked for:");
    console.error(lookedFor);
    console.error("\nNext steps:");
    console.error("- Download the iOS Firebase plist for this app environment from Firebase Console.");
    console.error("- Place it in ios/mychampions (preferred), ios, or project root.");
    console.error("- For dev, use GoogleService-Info-Dev.plist (fallback: GoogleService-Info.plist).");
    console.error("- For production, use GoogleService-Info.plist or GoogleService-Info-Prod.plist.");
    process.exit(1);
  }

  console.log("iOS Firebase config check passed.");
  console.log(`Environment: ${environment}`);
  console.log(`Using: ${relativeToRoot(root, foundFile)}`);
}

main();
