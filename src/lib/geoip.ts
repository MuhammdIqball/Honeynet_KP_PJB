import path from "path";
import maxmind, { Reader } from "maxmind";

export type Geo =
  | {
      lat: number;
      lon: number;
      country?: string;
      region?: string;
      city?: string;
    }
  | null;

declare global {
  // cache antar reload
  var __geoReader: Reader<any> | undefined;
  var __geoCache: Map<string, Geo> | undefined;
}

const DB_PATH = path.join(process.cwd(), "data", "GeoLite2-City.mmdb");

function isPrivateIp(ip: string) {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

async function getReader() {
  if (!global.__geoReader) {
    global.__geoReader = await maxmind.open(DB_PATH);
  }
  return global.__geoReader;
}

export async function geoLookup(ip: string): Promise<Geo> {
  if (!ip || isPrivateIp(ip)) return null;

  if (!global.__geoCache) global.__geoCache = new Map();
  if (global.__geoCache.has(ip)) return global.__geoCache.get(ip)!;

  const reader = await getReader();
  const r = reader.get(ip);

  const geo: Geo =
    r?.location?.latitude != null && r?.location?.longitude != null
      ? {
          lat: r.location.latitude,
          lon: r.location.longitude,
          country: r.country?.names?.en,
          region: r.subdivisions?.[0]?.names?.en,
          city: r.city?.names?.en,
        }
      : null;

  global.__geoCache.set(ip, geo);
  return geo;
}
