const RTK_JQ = /\brtk jq(?=\s|$)/g;

function restoreJq(value: unknown): unknown {
  if (typeof value === "string") return value.replace(RTK_JQ, "jq");
  if (Array.isArray(value)) return value.map(restoreJq);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreJq(v)]));
  }
  return value;
}

/**
 * rtk 1.1.0 rewrites jq to `rtk jq`, a TOML-filter fallback that cuts output at
 * 40 lines and records no savings (rtk-ai/rtk#4791, #1364).
 */
export function keepJqUnwrapped(rtkOutput: string): string {
  if (!RTK_JQ.test(rtkOutput)) return rtkOutput;
  RTK_JQ.lastIndex = 0;
  try {
    return JSON.stringify(restoreJq(JSON.parse(rtkOutput)));
  } catch {
    return rtkOutput;
  }
}
