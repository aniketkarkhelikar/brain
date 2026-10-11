/**
 * location.ts — Auto-location detection with 24-hour persistent caching.
 * Uses free IP geolocation (ip-api.com) with timezone-based fallback.
 * Zero API keys, 100% free.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export type UserLocation = {
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
  source: 'ip' | 'timezone' | 'default';
};

type LocationCache = {
  cachedAt: number;
  location: UserLocation;
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const IP_API_URL = 'http://ip-api.com/json';

function defaultStatePath(): string {
  return path.resolve(process.env.STATE_PATH || './state');
}

function locationCachePath(): string {
  return path.join(defaultStatePath(), 'location.json');
}

function defaultVaultPath(): string {
  return path.resolve(process.env.VAULT_PATH || './vault');
}

async function readUserContextLocation(): Promise<Partial<UserLocation> | null> {
  try {
    const userMdPath = path.join(defaultVaultPath(), 'USER.md');
    const content = await fs.readFile(userMdPath, 'utf8');
    const locationMatch = content.match(/- \*\*Location:\*\*\s*(.+)/i);
    const timezoneMatch = content.match(/- \*\*Timezone:\*\*\s*([^\s(]+)/i);

    const country = locationMatch?.[1]?.trim();
    const timezone = timezoneMatch?.[1]?.trim();

    const isPlaceholder = (val?: string) => !val || val.startsWith('(') || /^(unknown|none|tbd|to be learned)$/i.test(val);

    if (!isPlaceholder(country) || !isPlaceholder(timezone)) {
      return {
        country: !isPlaceholder(country) ? country : undefined,
        timezone: !isPlaceholder(timezone) ? timezone : undefined,
      };
    }
  } catch {
    // USER.md not readable
  }
  return null;
}

function timezoneFallback(): UserLocation {
  const tz =
    process.env.HEARTBEAT_TIMEZONE ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';

  let country: string | undefined;
  if (tz.startsWith('America/')) country = 'United States';
  else if (tz.startsWith('Europe/London')) country = 'United Kingdom';
  else if (tz.startsWith('Europe/')) country = 'Europe';
  else if (tz.startsWith('Asia/Tokyo')) country = 'Japan';
  else if (tz.startsWith('Asia/Singapore')) country = 'Singapore';
  else if (tz.startsWith('Asia/Dubai')) country = 'United Arab Emirates';
  else if (tz.startsWith('Asia/Kolkata') || tz.startsWith('Asia/Calcutta')) country = 'India';

  return {
    country,
    timezone: tz,
    source: 'timezone',
  };
}


export async function getUserLocation(forceRefresh = false): Promise<UserLocation> {
  const cacheFile = locationCachePath();

  if (!forceRefresh) {
    try {
      const raw = await fs.readFile(cacheFile, 'utf8');
      const data = JSON.parse(raw) as LocationCache;
      if (Date.now() - data.cachedAt < CACHE_TTL_MS && data.location?.country) {
        return data.location;
      }
    } catch {
      // Cache miss or unreadable
    }
  }

  // Attempt free IP lookup
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const response = await fetch(IP_API_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (AI-Brain/2.0)' },
    });
    clearTimeout(timer);

    if (response.ok) {
      const json = await response.json() as Record<string, unknown>;
      if (json.status === 'success') {
        const location: UserLocation = {
          city: typeof json.city === 'string' ? json.city : undefined,
          region: typeof json.regionName === 'string' ? json.regionName : undefined,
          country: typeof json.country === 'string' ? json.country : undefined,
          timezone: typeof json.timezone === 'string' ? json.timezone : undefined,
          source: 'ip',
        };

        // Cache result
        try {
          await fs.mkdir(path.dirname(cacheFile), { recursive: true });
          await fs.writeFile(
            cacheFile,
            JSON.stringify({ cachedAt: Date.now(), location } satisfies LocationCache, null, 2),
            'utf8',
          );
        } catch {
          // Non-critical cache write failure
        }

        return location;
      }
    }
  } catch {
    // Network or timeout failure
  }

  const userContext = await readUserContextLocation();
  const baseLocation = timezoneFallback();
  if (userContext?.country || userContext?.timezone) {
    return {
      ...baseLocation,
      country: userContext.country || baseLocation.country,
      timezone: userContext.timezone || baseLocation.timezone,
      source: 'user_context' as any,
    };
  }

  return baseLocation;
}


export function formatLocationContext(loc: UserLocation): string {
  const parts = [loc.city, loc.region, loc.country].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Unknown location';
}

