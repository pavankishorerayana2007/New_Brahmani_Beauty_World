const money = (n) => '\u20B9' + (Math.round(n * 100) / 100).toLocaleString('en-IN');
const ms = (d) => (d ? new Date(d).getTime() : 0);
module.exports = { money, ms };
