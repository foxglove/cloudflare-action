export function sanitizeBranchName(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+/g, "-")
    .substring(0, 50)
    .replace(/-+$/, "");
}

export function extractDeploymentUrl(output: string): string | undefined {
  const urls = output.match(/https:\/\/[^\s]+\.(?:pages|workers)\.dev/g);
  return urls?.[urls.length - 1];
}

export function parseBooleanInput(
  value: string | boolean | undefined,
  inputName: string,
  defaultValue: boolean,
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (value == undefined || value.trim() === "") {
    return defaultValue;
  }

  const normalized = value.trim();
  if (["true", "True", "TRUE"].includes(normalized)) {
    return true;
  }
  if (["false", "False", "FALSE"].includes(normalized)) {
    return false;
  }

  throw new Error(
    `${inputName} must be a boolean value. Accepted values: true | True | TRUE | false | False | FALSE`,
  );
}

export function parseJsonc(raw: string): Record<string, unknown> {
  const stripped = raw
    .replace(/"(?:[^"\\]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, (match) =>
      match.startsWith("/") ? "" : match,
    )
    .replace(/,\s*([\]}])/g, "$1");
  const parsed: unknown = JSON.parse(stripped);
  if (
    parsed == undefined ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return {};
  }
  return parsed as Record<string, unknown>;
}
