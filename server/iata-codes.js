// City-name → IATA-code lookup table plus geography helpers used by the
// router and providers. Add new cities here (lowercase key → uppercase
// code) when extending the planner. isRussianDirection drives provider
// fallback to Aviasales/Yandex Rasp; sameCityName is the canonical
// case-insensitive city comparator.

export const CITY_IATA_CODES = new Map([
  ['porto', 'OPO'],
  ['doha', 'DOH'],
  ['dubai', 'DXB'],
  ['gdansk', 'GDN'],
  ['lisbon', 'LIS'],
  ['istanbul', 'IST'],
  ['belgrade', 'BEG'],
  ['warsaw', 'WAW'],
  ['madrid', 'MAD'],
  ['barcelona', 'BCN'],
  ['milan', 'MIL'],
  ['rome', 'ROM'],
  ['paris', 'PAR'],
  ['frankfurt', 'FRA'],
  ['athens', 'ATH'],
  ['vienna', 'VIE'],
  ['zurich', 'ZRH'],
  ['amsterdam', 'AMS'],
  ['kaliningrad', 'KGD'],
  ['moscow', 'MOW'],
  ['moskow', 'MOW'],
  ['saint petersburg', 'LED'],
  ['st petersburg', 'LED'],
  ['st. petersburg', 'LED'],
  ['sankt petersburg', 'LED'],
  ['spb', 'LED'],
  ['led', 'LED']
]);

export const RUSSIAN_CITY_NAMES = new Set(['Kaliningrad', 'Moscow', 'Saint Petersburg']);
export const RUSSIAN_IATA_CODES = new Set(['KGD', 'MOW', 'SVO', 'DME', 'VKO', 'LED']);

// IATA → { city, airport, zone } for the airports we support. Used to:
//   - convert provider-returned UTC instants into the city's local
//     wall-clock time (zone)
//   - render friendly hub labels in the UI ("Istanbul Sabiha Gökçen")
// Add an entry whenever you add a new IATA to CITY_IATA_CODES; airport
// names cover the major hubs we surface (SAW, IST, CDG, FRA, etc.) plus
// general-purpose codes (OPO, MAD, …). When airport is null the UI
// falls back to "City (CODE)".
export const IATA_AIRPORTS = new Map([
  ['OPO', { city: 'Porto', airport: null, zone: 'Europe/Lisbon' }],
  ['LIS', { city: 'Lisbon', airport: null, zone: 'Europe/Lisbon' }],
  ['MAD', { city: 'Madrid', airport: 'Barajas', zone: 'Europe/Madrid' }],
  ['BCN', { city: 'Barcelona', airport: null, zone: 'Europe/Madrid' }],
  ['PAR', { city: 'Paris', airport: null, zone: 'Europe/Paris' }],
  ['CDG', { city: 'Paris', airport: 'Charles de Gaulle', zone: 'Europe/Paris' }],
  ['ORY', { city: 'Paris', airport: 'Orly', zone: 'Europe/Paris' }],
  ['AMS', { city: 'Amsterdam', airport: 'Schiphol', zone: 'Europe/Amsterdam' }],
  ['FRA', { city: 'Frankfurt', airport: null, zone: 'Europe/Berlin' }],
  ['MUC', { city: 'Munich', airport: null, zone: 'Europe/Berlin' }],
  ['ZRH', { city: 'Zurich', airport: null, zone: 'Europe/Zurich' }],
  ['MIL', { city: 'Milan', airport: null, zone: 'Europe/Rome' }],
  ['MXP', { city: 'Milan', airport: 'Malpensa', zone: 'Europe/Rome' }],
  ['ROM', { city: 'Rome', airport: null, zone: 'Europe/Rome' }],
  ['FCO', { city: 'Rome', airport: 'Fiumicino', zone: 'Europe/Rome' }],
  ['ATH', { city: 'Athens', airport: null, zone: 'Europe/Athens' }],
  ['IST', { city: 'Istanbul', airport: null, zone: 'Europe/Istanbul' }],
  ['SAW', { city: 'Istanbul', airport: 'Sabiha Gökçen', zone: 'Europe/Istanbul' }],
  ['VIE', { city: 'Vienna', airport: null, zone: 'Europe/Vienna' }],
  ['WAW', { city: 'Warsaw', airport: 'Chopin', zone: 'Europe/Warsaw' }],
  ['GDN', { city: 'Gdansk', airport: null, zone: 'Europe/Warsaw' }],
  ['BEG', { city: 'Belgrade', airport: null, zone: 'Europe/Belgrade' }],
  ['DOH', { city: 'Doha', airport: 'Hamad', zone: 'Asia/Qatar' }],
  ['DXB', { city: 'Dubai', airport: null, zone: 'Asia/Dubai' }],
  ['AUH', { city: 'Abu Dhabi', airport: null, zone: 'Asia/Dubai' }],
  ['MOW', { city: 'Moscow', airport: null, zone: 'Europe/Moscow' }],
  ['SVO', { city: 'Moscow', airport: 'Sheremetyevo', zone: 'Europe/Moscow' }],
  ['DME', { city: 'Moscow', airport: 'Domodedovo', zone: 'Europe/Moscow' }],
  ['VKO', { city: 'Moscow', airport: 'Vnukovo', zone: 'Europe/Moscow' }],
  ['LED', { city: 'Saint Petersburg', airport: 'Pulkovo', zone: 'Europe/Moscow' }],
  ['KGD', { city: 'Kaliningrad', airport: null, zone: 'Europe/Kaliningrad' }]
]);

export const IATA_TIMEZONES = new Map(
  [...IATA_AIRPORTS.entries()].map(([code, info]) => [code, info.zone])
);

// Carrier IATA → home hub IATA. Used as a fallback when the provider
// (Aviasales prices_for_dates) doesn't return the connecting airport
// for a leg with stops. Mark the resulting label as "Likely via …" in
// the UI so users know it's inferred. Add carriers conservatively: only
// those with a clearly dominant hub for the routes we serve.
export const CARRIER_HUBS = new Map([
  ['PC', 'SAW'], // Pegasus Airlines → Istanbul Sabiha Gökçen
  ['TK', 'IST'], // Turkish Airlines → Istanbul
  ['FZ', 'DXB'], // flydubai → Dubai
  ['EK', 'DXB'], // Emirates → Dubai
  ['QR', 'DOH'], // Qatar Airways → Doha
  ['LH', 'FRA'], // Lufthansa → Frankfurt
  ['KL', 'AMS'], // KLM → Amsterdam
  ['LX', 'ZRH'], // SWISS → Zurich
  ['AF', 'CDG'], // Air France → Paris CDG
  ['IB', 'MAD'], // Iberia → Madrid
  ['LO', 'WAW'], // LOT Polish Airlines → Warsaw
  ['A3', 'ATH'], // Aegean Airlines → Athens
  ['JU', 'BEG'], // Air Serbia → Belgrade
  ['TP', 'LIS'], // TAP Air Portugal → Lisbon
  ['OS', 'VIE']  // Austrian Airlines → Vienna
]);

export function airportLabel(iata) {
  if (!iata) return null;
  const info = IATA_AIRPORTS.get(iata);
  if (!info) return null;
  return info.airport ? `${info.city} ${info.airport}` : info.city;
}

export function inferLikelyHub(carrier, origin, destination) {
  const code = String(carrier || '').trim().toUpperCase();
  if (!code) return null;
  const hub = CARRIER_HUBS.get(code);
  // Inference only makes sense when the hub differs from both endpoints
  // — otherwise the "stop" isn't routing via that hub.
  if (!hub || hub === origin || hub === destination) return null;
  return hub;
}

// Compute the wall-clock arrival ISO ("YYYY-MM-DDTHH:mm:00") in the
// destination's local timezone, given a departure ISO with offset (e.g.
// "2026-05-21T13:30:00+01:00") and a duration in minutes. Returns null
// when any input is missing or the destination timezone is unknown.
export function arrivalIsoInZone(departureAt, durationMinutes, destinationIata) {
  if (!departureAt) return null;
  const minutes = Number(durationMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const zone = IATA_TIMEZONES.get(destinationIata);
  if (!zone) return null;
  const departureMs = new Date(departureAt).getTime();
  if (!Number.isFinite(departureMs)) return null;
  return formatInstantInZone(new Date(departureMs + minutes * 60 * 1000), zone);
}

function formatInstantInZone(date, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const grab = (type) => parts.find((part) => part.type === type)?.value;
  const hour = grab('hour') === '24' ? '00' : grab('hour');
  return `${grab('year')}-${grab('month')}-${grab('day')}T${hour}:${grab('minute')}:00`;
}

export function toIataCode(city) {
  const value = String(city || '').trim();
  if (/^[A-Z]{3}$/.test(value)) return value;
  const code = CITY_IATA_CODES.get(value.toLowerCase());
  if (!code) {
    throw new Error(`No IATA code configured for ${value}. Use a 3-letter airport/city code for pricing.`);
  }
  return code;
}

export function isRussianDirection(leg) {
  return (
    RUSSIAN_CITY_NAMES.has(leg.from) ||
    RUSSIAN_CITY_NAMES.has(leg.to) ||
    RUSSIAN_IATA_CODES.has(leg.origin) ||
    RUSSIAN_IATA_CODES.has(leg.destination)
  );
}

export function sameCityName(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}
