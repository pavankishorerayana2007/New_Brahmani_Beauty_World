// Vercel serverless entry. vercel.json rewrites every /api/* request to this function.
module.exports = require('../server/app');
