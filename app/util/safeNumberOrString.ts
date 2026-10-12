export default function safeNumberOrString(obj: Record<string, any>) {
  for (const [key, value] of Object.entries(obj)) {
    if (value && !Number.isSafeInteger(value)) {
      obj[key] = value.toString();
    }
  }
  return obj;
}
