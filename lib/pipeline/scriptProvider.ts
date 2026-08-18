export type ScriptProvider = 'auto' | 'dmx' | 'apimart';
export type ConcreteScriptProvider = Exclude<ScriptProvider, 'auto'>;

export function scriptProviderOrder(
  provider: ScriptProvider = 'auto',
  hasDmxKey = false,
  hasApiMartKey = false,
): ConcreteScriptProvider[] {
  if (provider === 'dmx') return hasDmxKey ? ['dmx'] : [];
  if (provider === 'apimart') return hasApiMartKey ? ['apimart'] : [];
  return [
    ...(hasDmxKey ? ['dmx' as const] : []),
    ...(hasApiMartKey ? ['apimart' as const] : []),
  ];
}
