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
