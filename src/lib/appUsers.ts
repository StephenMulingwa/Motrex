const BUILTIN_APP_USERS: Record<string, string> = {};

function normalizeAppUsername(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeUserPasswordMap(source: Record<string, unknown>, label: string): Record<string, string> {
  return Object.entries(source).reduce<Record<string, string>>((acc, [username, password]) => {
    if (typeof password !== "string") {
      throw new Error(`${label} entry for "${username}" must have a string password.`);
    }
    const normalizedUsername = normalizeAppUsername(username);
    const trimmedPassword = password.trim();
    if (normalizedUsername && trimmedPassword) {
      acc[normalizedUsername] = trimmedPassword;
    }
    return acc;
  }, {});
}

function getAppUsersFromEnv(): Record<string, string> | null {
  const raw = process.env.MOTREX_APP_USERS_JSON?.trim();
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MOTREX_APP_USERS_JSON must be a valid JSON object of username/password pairs.");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("MOTREX_APP_USERS_JSON must be a JSON object of username/password pairs.");
  }
  const normalizedEntries = normalizeUserPasswordMap(parsed as Record<string, unknown>, "MOTREX_APP_USERS_JSON");
  if (!Object.keys(normalizedEntries).length) {
    throw new Error("MOTREX_APP_USERS_JSON does not contain any valid login entries.");
  }
  return normalizedEntries;
}

export function getAppUsers(): Record<string, string> {
  const fromEnv = getAppUsersFromEnv();
  if (!fromEnv) return { ...BUILTIN_APP_USERS };
  return { ...BUILTIN_APP_USERS, ...fromEnv };
}

export function verifyAppCredentials(username: string, password: string) {
  const users = getAppUsers();
  const expectedPassword = users[normalizeAppUsername(username)];
  const given = String(password ?? "").trim();
  return typeof expectedPassword === "string" && given === expectedPassword;
}
