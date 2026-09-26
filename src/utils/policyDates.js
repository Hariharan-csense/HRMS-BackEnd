// Policy dates are calendar dates, not instants in the server's timezone.
const monthStartEnd = (dateValue) => {
  const [year, month] = String(dateValue).slice(0, 10).split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return {
    start: `${prefix}-01`,
    end: `${prefix}-${String(lastDay).padStart(2, "0")}`,
  };
};

module.exports = { monthStartEnd };
