// The frontend uses readable ids (P12, NB-1001, DR-3). The database uses plain numbers.
const mk = (prefix) => ({
  to: (n) => prefix + n,
  from: (s) => {
    const m = new RegExp('^' + prefix + '(\\d{1,12})$').exec(String(s));
    return m ? Number(m[1]) : null;
  },
});
module.exports = { product: mk('P'), order: mk('NB-'), request: mk('DR-') };
