// Ordinary Story projects keep their existing keys. A series runner gets its
// own namespace, including settings and auto-run intent, so tabs cannot collide.
export function storyStorageKeys(scope?: string) {
  const value =
    scope ??
    (typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("seriesProject") || "");
  const suffix = /^[a-zA-Z0-9_-]{1,120}$/.test(value) ? `:series:${value}` : "";
  return {
    current: `aid:current-project:v2${suffix}`,
    legacy: suffix ? `aid:series:legacy${suffix}` : "currentProject",
    auto: `aid:auto-production${suffix}`,
    settings: `appSettings${suffix}`,
    contract: `aid:series-contract${suffix}`,
    isolated: Boolean(suffix),
  };
}
