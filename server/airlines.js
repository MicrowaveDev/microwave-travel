const AIRLINES = new Map([
  ['A3', { name: 'Aegean Airlines', website: 'https://www.aegeanair.com/' }],
  ['DP', { name: 'Pobeda', website: 'https://www.pobeda.aero/' }],
  ['EK', { name: 'Emirates', website: 'https://www.emirates.com/' }],
  ['FR', { name: 'Ryanair', website: 'https://www.ryanair.com/' }],
  ['FZ', { name: 'flydubai', website: 'https://www.flydubai.com/' }],
  ['HV', { name: 'Transavia', website: 'https://www.transavia.com/' }],
  ['IB', { name: 'Iberia', website: 'https://www.iberia.com/' }],
  ['JU', { name: 'Air Serbia', website: 'https://www.airserbia.com/' }],
  ['KL', { name: 'KLM', website: 'https://www.klm.com/' }],
  ['LH', { name: 'Lufthansa', website: 'https://www.lufthansa.com/' }],
  ['LO', { name: 'LOT Polish Airlines', website: 'https://www.lot.com/' }],
  ['LX', { name: 'SWISS', website: 'https://www.swiss.com/' }],
  ['PC', { name: 'Pegasus Airlines', website: 'https://www.flypgs.com/' }],
  ['QR', { name: 'Qatar Airways', website: 'https://www.qatarairways.com/' }],
  ['TK', { name: 'Turkish Airlines', website: 'https://www.turkishairlines.com/' }],
  ['TO', { name: 'Transavia France', website: 'https://www.transavia.com/' }],
  ['TP', { name: 'TAP Air Portugal', website: 'https://www.flytap.com/' }],
  ['U2', { name: 'easyJet', website: 'https://www.easyjet.com/' }],
  ['VY', { name: 'Vueling', website: 'https://www.vueling.com/' }],
  ['W6', { name: 'Wizz Air', website: 'https://wizzair.com/' }]
]);

const AIRLINE_NAME_ALIASES = new Map(
  [...AIRLINES.values()].flatMap((airline) => [
    [normalizeAirlineName(airline.name), airline],
    [normalizeAirlineName(airline.name.replace(/airlines?/i, '')), airline]
  ])
);

AIRLINE_NAME_ALIASES.set('tap portugal', AIRLINES.get('TP'));
AIRLINE_NAME_ALIASES.set('tap air portugal', AIRLINES.get('TP'));
AIRLINE_NAME_ALIASES.set('ryanair', AIRLINES.get('FR'));
AIRLINE_NAME_ALIASES.set('pegasus', AIRLINES.get('PC'));
AIRLINE_NAME_ALIASES.set('pegasus airlines', AIRLINES.get('PC'));

export function airlineInfoForCarrier(carrier) {
  const raw = String(carrier || '').trim();
  if (!raw) return null;
  const code = normalizeCarrierCode(raw);
  const byCode = code ? AIRLINES.get(code) : null;
  if (byCode) return { code, ...byCode };
  const byName = AIRLINE_NAME_ALIASES.get(normalizeAirlineName(raw));
  if (byName) return { code: null, ...byName };
  return { code: code || null, name: raw, website: null };
}

export function normalizeCarrierCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{2}$/.test(raw) ? raw : null;
}

function normalizeAirlineName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
