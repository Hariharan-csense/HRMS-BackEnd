const sanitizeAddress = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/^zone\s*\d+\s*/i, "").replace(/\s+/g, " ").trim();
};

const normalizeDomain = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    // Allow passing full origins like "http://localhost:5173"
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return new URL(raw).hostname;
    }
  } catch {
    // ignore
  }
  // Strip protocol, port, and path if someone passed a URL-like string
  return raw
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .trim();
};

const pickFirstString = (...candidates) => {
  for (const candidate of candidates) {
    const cleaned = sanitizeAddress(candidate);
    if (cleaned) return cleaned;
  }
  return "";
};

const uniqParts = (parts = []) => {
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const cleaned = sanitizeAddress(part);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
};

const buildDetailedAddress = (resultLike = {}) => {
  // Mappls reverse-geocode often returns structured address pieces.
  // Prefer those over formatted strings to surface POI/building names when available.
  const poiOrBuilding = pickFirstString(
    resultLike.houseName,
    resultLike.house_name,
    resultLike.poi,
    resultLike.placeName,
    resultLike.place_name,
    resultLike.building,
    resultLike.amenity
  );

  const houseNumber = pickFirstString(resultLike.houseNumber, resultLike.house_number);
  const road = pickFirstString(resultLike.street, resultLike.road, resultLike.localityName, resultLike.locality_name);
  const subLocality = pickFirstString(resultLike.subLocality, resultLike.sub_locality, resultLike.suburb);
  const locality = pickFirstString(resultLike.locality, resultLike.neighbourhood, resultLike.neighborhood);
  const city = pickFirstString(resultLike.city, resultLike.town, resultLike.village);
  const district = pickFirstString(resultLike.district);
  const state = pickFirstString(resultLike.state);
  const pincode = pickFirstString(resultLike.pincode, resultLike.postcode, resultLike.pin);

  const parts = uniqParts([
    poiOrBuilding,
    houseNumber,
    road,
    subLocality,
    locality,
    city,
    district,
    state,
    pincode,
  ]);

  return parts.join(", ");
};

const nearbyPoiMappls = async ({ latitude, longitude, radiusMeters = 200, signal, domain } = {}) => {
  const accessToken = String(process.env.MAPPLS_ACCESS_TOKEN || "").trim();
  if (!accessToken) {
    const error = new Error("MAPPLS_ACCESS_TOKEN not configured");
    error.code = "MAPPLS_NOT_CONFIGURED";
    throw error;
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const url = new URL("https://search.mappls.com/search/places/nearby/json");
  // Docs: keywords can accept "POI" to discover nearby POIs.
  url.searchParams.set("keywords", "POI");
  url.searchParams.set("refLocation", `${lat},${lng}`);
  url.searchParams.set("radius", String(radiusMeters));
  url.searchParams.set("sortBy", "dist:asc");
  url.searchParams.set("searchBy", "dist");
  url.searchParams.set("region", "IND");
  url.searchParams.set("access_token", accessToken);
  const effectiveDomain = normalizeDomain(domain || process.env.MAPPLS_DOMAIN);
  if (effectiveDomain) url.searchParams.set("domain", effectiveDomain);

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  const first = Array.isArray(data?.suggestedLocations) ? data.suggestedLocations[0] : null;
  if (!first) return null;

  const placeName = sanitizeAddress(first.placeName || first.place_name);
  const placeAddress = sanitizeAddress(first.placeAddress || first.place_address);
  const combined = uniqParts([placeName, placeAddress]).join(", ");
  if (!combined) return null;

  return {
    address: combined,
    raw: data,
  };
};

const reverseGeocodeMappls = async ({ latitude, longitude, signal, domain } = {}) => {
  const accessToken = String(process.env.MAPPLS_ACCESS_TOKEN || "").trim();
  if (!accessToken) {
    const error = new Error("MAPPLS_ACCESS_TOKEN not configured");
    error.code = "MAPPLS_NOT_CONFIGURED";
    throw error;
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const error = new Error("Invalid latitude/longitude");
    error.code = "INVALID_COORDS";
    throw error;
  }

  const url = new URL("https://search.mappls.com/search/address/rev-geocode");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  url.searchParams.set("access_token", accessToken);
  const effectiveDomain = normalizeDomain(domain || process.env.MAPPLS_DOMAIN);
  if (effectiveDomain) url.searchParams.set("domain", effectiveDomain);

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`Mappls reverse geocode failed (${response.status})`);
    error.code = response.status === 401 ? "MAPPLS_AUTH_ERROR" : "MAPPLS_HTTP_ERROR";
    error.status = response.status;
    error.body = body;
    error.domainUsed = effectiveDomain || "";
    throw error;
  }

  const data = await response.json();
  const first = Array.isArray(data?.results) ? data.results[0] : null;
  const structured = first ? buildDetailedAddress(first) : "";
  const reverseAddress =
    sanitizeAddress(structured) ||
    pickFirstString(first?.formatted_address, first?.formattedAddress, first?.address, data?.display_name);

  // Try to enrich with a nearby POI name + address (if available).
  // This helps cases where reverse-geocode returns only an administrative label.
  const nearbyPoi = await nearbyPoiMappls({
    latitude: lat,
    longitude: lng,
    signal,
    domain: effectiveDomain,
  }).catch(() => null);
  const address = nearbyPoi?.address || reverseAddress;

  return {
    address,
    raw: {
      reverse: data,
      nearbyPoi: nearbyPoi?.raw || null,
    },
  };
};

module.exports = {
  reverseGeocodeMappls,
  nearbyPoiMappls,
};
