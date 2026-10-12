export function getNextVersion(current?: string): string {
  if (!current) return "v_0.01";
  const num = parseFloat(current.replace("v_", ""));
  if (isNaN(num)) return "v_0.01";
  const next = Math.round((num + 0.01) * 100) / 100;
  return `v_${next.toFixed(2)}`;
}