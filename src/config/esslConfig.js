const positive = (value, fallback, max) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= max ? number : fallback;
};
module.exports = () => ({
  enabled: process.env.ESSL_ENABLED === "true",
  syncEnabled: process.env.ESSL_SYNC_ENABLED === "true",
  intervalMs: positive(process.env.ESSL_SYNC_INTERVAL_MINUTES, 5, 1440) * 60000,
  connectionTimeout: positive(process.env.ESSL_CONNECTION_TIMEOUT, 10000, 120000),
});

