const sanitizeAddress = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/\s+/g, " ").trim();
};

const fetchJson = async (url, { signal } = {}) => {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`Google API failed (${response.status})`);
    error.code = "GOOGLE_HTTP_ERROR";
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return response.json();
};

const pickPostalCode = (geocodeData) => {
  const results = Array.isArray(geocodeData?.results) ? geocodeData.results : [];
  for (const result of results) {
    const components = Array.isArray(result?.address_components) ? result.address_components : [];
    for (const component of components) {
      const types = Array.isArray(component?.types) ? component.types : [];
      if (types.includes("postal_code")) {
        return sanitizeAddress(component?.long_name || component?.short_name);
      }
    }
  }
  return "";
};

const chooseBestGeocodeResult = (geocodeData) => {
  const results = Array.isArray(geocodeData?.results) ? geocodeData.results : [];
  if (results.length === 0) return null;

  const typePriority = [
    "premise",
    "subpremise",
    "street_address",
    "point_of_interest",
    "establishment",
    "route",
    "neighborhood",
    "sublocality",
    "locality",
    "administrative_area_level_3",
    "administrative_area_level_2",
    "administrative_area_level_1",
  ];

  const score = (types = []) => {
    const set = new Set(types);
    const idx = typePriority.findIndex((t) => set.has(t));
    return idx === -1 ? 999 : idx;
  };

  return [...results].sort((a, b) => score(a?.types) - score(b?.types))[0];
};

const reverseGeocodeViaGeocoding = async ({ lat, lng, apiKey, signal }) => {
  const geocodeUrl = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  geocodeUrl.searchParams.set("latlng", `${lat},${lng}`);
  geocodeUrl.searchParams.set("key", apiKey);

  const geocodeData = await fetchJson(geocodeUrl, { signal });
  if (!geocodeData || geocodeData.status !== "OK") {
    const error = new Error(`Google geocoding returned status ${String(geocodeData?.status || "UNKNOWN")}`);
    error.code = "GOOGLE_BAD_RESPONSE";
    error.statusText = geocodeData?.status;
    error.raw = geocodeData;
    throw error;
  }

  const best = chooseBestGeocodeResult(geocodeData);
  const formatted = sanitizeAddress(best?.formatted_address || geocodeData?.results?.[0]?.formatted_address);
  return { address: formatted, raw: geocodeData };
};

const reverseGeocodeViaPlaces = async ({ lat, lng, apiKey, signal }) => {
  // Nearby Search (rank by distance) to get nearest POI/building name.
  // Note: Requires enabling Places API for the key.
  const placesUrl = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  placesUrl.searchParams.set("location", `${lat},${lng}`);
  placesUrl.searchParams.set("rankby", "distance");
  placesUrl.searchParams.set("type", "establishment");
  placesUrl.searchParams.set("key", apiKey);

  const placesData = await fetchJson(placesUrl, { signal });
  if (!placesData || placesData.status !== "OK") {
    const error = new Error(`Google places returned status ${String(placesData?.status || "UNKNOWN")}`);
    error.code = "GOOGLE_PLACES_BAD_RESPONSE";
    error.statusText = placesData?.status;
    error.raw = placesData;
    throw error;
  }

  const first = Array.isArray(placesData?.results) ? placesData.results[0] : null;
  if (!first) {
    const error = new Error("Google places returned no results");
    error.code = "GOOGLE_PLACES_EMPTY";
    error.raw = placesData;
    throw error;
  }

  const name = sanitizeAddress(first?.name);
  const vicinity = sanitizeAddress(first?.vicinity);
  const combined = [name, vicinity].filter(Boolean).join(", ");

  return { address: combined, raw: placesData };
};

const reverseGeocodeGoogle = async ({ latitude, longitude, signal } = {}) => {
  // IMPORTANT: Server-side calls must use a server-restricted key (IP-based or unrestricted),
  // not a browser (HTTP referrer) restricted key.
  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();

  if (!apiKey) {
    const error = new Error("GOOGLE_MAPS_API_KEY not configured");
    error.code = "GOOGLE_NOT_CONFIGURED";
    throw error;
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const error = new Error("Invalid latitude/longitude");
    error.code = "INVALID_COORDS";
    throw error;
  }

  // 1) Prefer Places (POI/building name). If Places isn't enabled, fallback to Geocoding.
  let placesResult = null;
  let placesFailure = null;
  try {
    placesResult = await reverseGeocodeViaPlaces({ lat, lng, apiKey, signal });
  } catch (error) {
    // Most common: REQUEST_DENIED (Places API not enabled) or ZERO_RESULTS.
    // We'll fallback to Geocoding below.
    placesFailure = {
      code: error?.code,
      statusText: error?.statusText,
      status: error?.status,
      raw: error?.raw,
    };
  }

  const geocodeResult = await reverseGeocodeViaGeocoding({ lat, lng, apiKey, signal });
  const postalCode = pickPostalCode(geocodeResult.raw);

  if (placesResult?.address) {
    const withPin =
      postalCode && !placesResult.address.includes(postalCode)
        ? `${placesResult.address}, ${postalCode}`
        : placesResult.address;
    return {
      address: withPin,
      raw: { places: placesResult.raw, geocode: geocodeResult.raw },
      source: "places",
    };
  }

  return {
    address: geocodeResult.address || "",
    raw: { geocode: geocodeResult.raw, placesFailure },
    source: "geocode",
  };
};

module.exports = {
  reverseGeocodeGoogle,
};
