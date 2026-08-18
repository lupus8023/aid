import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>, family?: number) => void;

const DOH_ENDPOINTS = [
  { ip: '223.5.5.5', servername: 'dns.alidns.com', path: '/resolve' },
  { ip: '1.1.1.1', servername: 'cloudflare-dns.com', path: '/dns-query' },
  { ip: '8.8.8.8', servername: 'dns.google', path: '/resolve' },
] as const;

const cache = new Map<string, { addresses: string[]; expiresAt: number; cursor: number }>();
let localProviderAgent: https.Agent | undefined;

function dohRequest(endpoint: (typeof DOH_ENDPOINTS)[number], hostname: string): Promise<{ addresses: string[]; ttl: number }> {
  return new Promise((resolve, reject) => {
    const request = https.get({
      host: endpoint.ip,
      servername: endpoint.servername,
      path: `${endpoint.path}?name=${encodeURIComponent(hostname)}&type=A`,
      headers: { host: endpoint.servername, accept: 'application/dns-json' },
      timeout: 6000,
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 64 * 1024) request.destroy(new Error('DNS response is too large'));
      });
      response.once('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`DNS HTTP ${response.statusCode || 0}`));
        try {
          const data = JSON.parse(body);
          const answers = Array.isArray(data?.Answer) ? data.Answer : data?.Answer ? [data.Answer] : [];
          const ipv4: string[] = answers
            .filter((answer: any) => Number(answer?.type) === 1 && net.isIPv4(String(answer?.data || '')))
            .map((answer: any) => String(answer.data));
          if (!ipv4.length) return reject(new Error(`Public DNS returned no A record for ${hostname}`));
          const ttl = Math.max(60, Math.min(300, Number(answers[0]?.TTL) || 60));
          resolve({ addresses: [...new Set(ipv4)], ttl });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once('timeout', () => request.destroy(new Error('DNS request timed out')));
    request.once('error', reject);
  });
}

export async function resolvePublicIpv4(hostname: string): Promise<string[]> {
  const normalized = hostname.trim().toLowerCase();
  if (net.isIPv4(normalized)) return [normalized];
  const cached = cache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.addresses;

  let lastError: unknown;
  for (const endpoint of DOH_ENDPOINTS) {
    try {
      const result = await dohRequest(endpoint, normalized);
      cache.set(normalized, {
        addresses: result.addresses,
        expiresAt: Date.now() + result.ttl * 1000,
        cursor: cached?.cursor || 0,
      });
      return result.addresses;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Public DNS failed for ${normalized}`);
}

function publicLookup(hostname: string, options: number | dns.LookupOneOptions | dns.LookupAllOptions, callback: LookupCallback): void {
  const all = typeof options === 'object' && Boolean(options.all);
  if (net.isIP(hostname)) {
    if (all) callback(null, [{ address: hostname, family: net.isIP(hostname) }]);
    else callback(null, hostname, net.isIP(hostname));
    return;
  }

  resolvePublicIpv4(hostname).then(addresses => {
    const entry = cache.get(hostname.toLowerCase());
    const index = entry ? entry.cursor++ % addresses.length : 0;
    const ordered = [...addresses.slice(index), ...addresses.slice(0, index)];
    if (all) callback(null, ordered.map(address => ({ address, family: 4 })));
    else callback(null, ordered[0], 4);
  }).catch(() => {
    dns.lookup(hostname, options as any, callback as any);
  });
}

export function providerHttpsAgent(): https.Agent | undefined {
  if (process.env.AID_LOCAL_COMPANION !== '1') return undefined;
  if (!localProviderAgent) {
    localProviderAgent = new https.Agent({ keepAlive: true, lookup: publicLookup as any });
  }
  return localProviderAgent;
}
