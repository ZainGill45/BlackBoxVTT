import { readFile } from "node:fs/promises";

const packageContents = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const allowedDependencies = JSON.parse(await readFile(new URL("../allowed-dependencies.json", import.meta.url), "utf8"));

const dependencyGroups = ["dependencies", "devDependencies"];
const dependencyDifferences = [];

for (const dependencyGroup of dependencyGroups) {
  const packageDependencyNames = Object.keys(packageContents[dependencyGroup] ?? {}).sort();
  const allowedDependencyNames = [...(allowedDependencies[dependencyGroup] ?? [])].sort();
  const unapprovedDependencyNames = packageDependencyNames.filter((dependencyName) => !allowedDependencyNames.includes(dependencyName));
  const staleAllowedDependencyNames = allowedDependencyNames.filter((dependencyName) => !packageDependencyNames.includes(dependencyName));

  if (unapprovedDependencyNames.length > 0) {
    dependencyDifferences.push(`${dependencyGroup} contains unapproved dependencies: ${unapprovedDependencyNames.join(", ")}`);
  }

  if (staleAllowedDependencyNames.length > 0) {
    dependencyDifferences.push(`${dependencyGroup} allowlist contains dependencies absent from package.json: ${staleAllowedDependencyNames.join(", ")}`);
  }
}

if (dependencyDifferences.length > 0) {
  throw new Error(dependencyDifferences.join("\n"));
}
