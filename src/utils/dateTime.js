const APP_TIME_ZONE = "Asia/Kolkata";

const getZonedDateParts = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;

  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
  };
};

const getDateKey = (value = new Date()) => {
  const parts = getZonedDateParts(value);
  if (!parts) return null;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
};

const getMonthKey = (value = new Date()) => getDateKey(value)?.slice(0, 7) || null;

const addDaysToDateKey = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const formatTime = (value, options = {}) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleTimeString(options.locale || "en-IN", {
    timeZone: APP_TIME_ZONE,
    hour: options.hour || "2-digit",
    minute: options.minute || "2-digit",
    ...(options.second ? { second: options.second } : {}),
    hour12: options.hour12 ?? true,
  });
};

module.exports = {
  APP_TIME_ZONE,
  addDaysToDateKey,
  formatTime,
  getDateKey,
  getMonthKey,
  getZonedDateParts,
};
