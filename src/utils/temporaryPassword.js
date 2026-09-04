const crypto = require("crypto");

const generateTemporaryPassword = () => {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%"];
  const all = groups.join("");
  const chars = groups.map((group) => group[crypto.randomInt(group.length)]);
  while (chars.length < 12) chars.push(all[crypto.randomInt(all.length)]);
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
  }
  return chars.join("");
};

module.exports = { generateTemporaryPassword };
