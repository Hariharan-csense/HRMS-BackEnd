const { reverseGeocodeMappls } = require("../services/mapplsGeocode");
const { reverseGeocodeGoogle } = require("../services/googleGeocode");

const isAdminUser = (user) => {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const roleNames = new Set([String(user?.role || "").toLowerCase(), ...roles.map((r) => String(r || "").toLowerCase())]);
  return roleNames.has("admin") || roleNames.has("superadmin");
};

const geocodeWarnings = new Set();

const warnOnce = (key, ...args) => {
  if (geocodeWarnings.has(key)) return;
  geocodeWarnings.add(key);
  console.warn(...args);
};

const buildCoordinateFallback = (latitude, longitude) =>
  `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`;

const sendCoordinateFallback = (res, latitude, longitude, extra = {}) =>
  res.json({
    success: true,
    address: buildCoordinateFallback(latitude, longitude),
    provider: "coordinates",
    fallback: true,
    ...extra,
  });

const getPreferredGeocodeProvider = () => {
  const provider = String(process.env.GEOCODE_PROVIDER || "auto")
    .trim()
    .toLowerCase();
  return ["google", "mappls", "auto"].includes(provider) ? provider : "auto";
};

const getGoogleKeySuffix = () => {
  const key = String(
    process.env.GOOGLE_GEOCODING_API_KEY ||
      process.env.GOOGLE_SERVER_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      "",
  ).trim();
  if (!key) return "";
  return key.slice(-6);
};

const reverseGeocode = async (req, res) => {
  const latRaw = req.query.lat ?? req.query.latitude;
  const lngRaw = req.query.lng ?? req.query.lon ?? req.query.longitude;

  const latitude = Number(latRaw);
  const longitude = Number(lngRaw);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({
      success: false,
      message: "Invalid latitude/longitude",
    });
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 7000);
  try {
    const originHeader = String(req.headers.origin || req.headers.referer || "").trim();
    const domain = originHeader || req.hostname;

    const debugEnabled = req.query.debug === "1" && isAdminUser(req.user);
    const envProvider = getPreferredGeocodeProvider();
    const requestedProvider = String(req.query.provider || "").toLowerCase().trim();
    const forceProvider = requestedProvider || (envProvider === "auto" ? "" : envProvider); // "google" | "mappls"
    const allowFallback = String(req.query.fallback || "").toLowerCase().trim() === "1";
    let result = null;
    let provider = null;
    let googleFailure = null;

    // 1) Prefer Google if configured (most consistent "location name")
    if (!forceProvider || forceProvider === "google") {
      try {
        result = await reverseGeocodeGoogle({
          latitude,
          longitude,
          signal: abortController.signal,
        });
        provider = result?.source === "places" ? "google_places" : "google_geocode";
      } catch (googleError) {
        if (googleError?.code !== "GOOGLE_NOT_CONFIGURED") {
          warnOnce(
            `google-${googleError?.code || googleError?.statusText || "failed"}`,
            "Google reverse geocode failed:",
            googleError?.message || googleError,
          );
        }
        if (debugEnabled) {
          googleFailure = {
            code: googleError?.code,
            status: googleError?.status,
            statusText: googleError?.statusText,
            body: googleError?.body,
            raw: googleError?.raw,
            message: String(googleError?.message || ""),
          };
        }
      }
    }

    // 2) Fallback to Mappls (optional; disabled by default when Google key exists but fails)
    const googleKeyPresent = Boolean(
      String(
        process.env.GOOGLE_GEOCODING_API_KEY ||
          process.env.GOOGLE_SERVER_API_KEY ||
          process.env.GOOGLE_MAPS_API_KEY ||
          "",
      ).trim(),
    );
    const shouldTryMappls =
      (!result &&
        (forceProvider === "mappls" ||
          (!googleKeyPresent && !forceProvider) ||
          (allowFallback && googleKeyPresent)));

    if (shouldTryMappls) {
      try {
        result = await reverseGeocodeMappls({
          latitude,
          longitude,
          signal: abortController.signal,
          domain,
        });
        provider = "mappls";
      } catch (mapplsError) {
        warnOnce(
          `mappls-${mapplsError?.code || mapplsError?.status || "failed"}`,
          "Mappls reverse geocode failed:",
          mapplsError?.message || mapplsError,
        );
        return sendCoordinateFallback(res, latitude, longitude, {
          ...(debugEnabled
            ? {
                googleFailure,
                mapplsStatus: mapplsError?.status,
                mapplsDomainUsed: mapplsError?.domainUsed,
                mapplsBody: mapplsError?.body,
              }
            : {}),
        });
      }
    }

    if (!result) {
      // No provider succeeded (or Mappls fallback intentionally skipped).
      // Keep UI/network flow healthy and return coordinates as a readable fallback.
      return sendCoordinateFallback(res, latitude, longitude, {
        ...(debugEnabled
          ? {
              googleFailure,
              googleKeySuffix: getGoogleKeySuffix(),
              serverHost: req.hostname,
            }
          : {}),
      });
    }

    return res.json({
      success: true,
      address: result.address,
      provider,
      ...(debugEnabled ? { raw: result.raw, googleFailure } : {}),
    });
  } catch (error) {
    const debugEnabled = req.query.debug === "1" && isAdminUser(req.user);
    if (error?.code === "MAPPLS_NOT_CONFIGURED") {
      return sendCoordinateFallback(res, latitude, longitude);
    }
    if (error?.code === "GOOGLE_NOT_CONFIGURED") {
      return sendCoordinateFallback(res, latitude, longitude);
    }

    if (String(error?.name || "").toLowerCase() === "aborterror") {
      return res.status(504).json({
        success: false,
        message: "Reverse geocoding timed out",
      });
    }

    warnOnce(
      `reverse-${error?.code || error?.status || "failed"}`,
      "Reverse geocoding failed:",
      error?.message || error,
    );
    return sendCoordinateFallback(res, latitude, longitude, {
      ...(debugEnabled
        ? {
            mapplsStatus: error?.status,
            mapplsDomainUsed: error?.domainUsed,
            mapplsBody: error?.body,
          }
        : {}),
    });
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  reverseGeocode,
};
