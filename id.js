export function makeId(prefix, cryptoObject = globalThis.crypto) {
  const randomUuid = typeof cryptoObject?.randomUUID === "function"
    ? cryptoObject.randomUUID.bind(cryptoObject)
    : null;

  if (randomUuid) {
    return `${prefix}-${randomUuid()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
}
