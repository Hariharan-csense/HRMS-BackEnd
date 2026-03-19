const { reverseGeocodeMappls } = require("../services/mapplsGeocode");
const { reverseGeocodeGoogle } = require("../services/googleGeocode");

const isAdminUser = (user) => {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const roleNames = new Set([String(user?.role || "").toLowerCase(), ...roles.map((r) => String(r || "").toLowerCase())]);
  return roleNames.has("admin") || roleNames.has("superadmin");
};

const getGoogleKeySuffix = () => {
  const key = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
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
    const forceProvider = String(req.query.provider || "").toLowerCase().trim(); // "google" | "mappls"
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
          console.warn("Google reverse geocode failed:", googleError?.message || googleError);
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
    const googleKeyPresent = Boolean(String(process.env.GOOGLE_MAPS_API_KEY || "").trim());
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
        console.error("Reverse geocoding failed:", mapplsError);
        return res.status(502).json({
          success: false,
          message: "Reverse geocoding failed",
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
      // No provider succeeded (or Mappls fallback intentionally skipped)
      return res.status(502).json({
        success: false,
        message: "Reverse geocoding failed",
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
      return res.status(501).json({
        success: false,
        message: "Mappls reverse geocoding not configured",
      });
    }
    if (error?.code === "GOOGLE_NOT_CONFIGURED") {
      return res.status(501).json({
        success: false,
        message: "Google reverse geocoding not configured",
      });
    }

    if (String(error?.name || "").toLowerCase() === "aborterror") {
      return res.status(504).json({
        success: false,
        message: "Reverse geocoding timed out",
      });
    }

    console.error("Reverse geocoding failed:", error);
    return res.status(502).json({
      success: false,
      message: "Reverse geocoding failed",
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
