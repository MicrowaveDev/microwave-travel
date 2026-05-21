// Attach Aviasales search URLs to priced legs. Contiguous flight legs
// (same airport handoff, no overnight stay between them) share a
// multi-segment bookingGroupUrl; standalone legs get a one-way
// bookingUrl. TRAVELPAYOUTS_MARKER env var, when set, flips the labels
// to "Affiliate search link".

const AVIASALES_SEARCH_BASE_URL = process.env.AVIASALES_SEARCH_BASE_URL || 'https://search.aviasales.com/flights/';

export function addBookingLinks(legs) {
  const linkedLegs = legs.map(addBookingLink);
  for (const group of contiguousFlightGroups(linkedLegs)) {
    if (group.length < 2) continue;
    const url = buildAviasalesSearchUrlForLegs(group);
    if (!url) continue;
    const route = group.map((leg) => leg.from).concat(group.at(-1).to).join(' -> ');
    for (const leg of group) {
      leg.bookingGroupUrl = url;
      leg.bookingGroupLabel = 'Search transfer route';
      leg.bookingGroupNote = `Search ${route}; compare final checkout price before booking.`;
    }
  }
  return linkedLegs;
}

function addBookingLink(leg) {
  if (leg.mode === 'bus' || !leg.origin || !leg.destination || !leg.departureDate) return leg;
  const url = buildAviasalesSearchUrlForLegs([leg]);
  if (!url) return leg;
  const hasAffiliateMarker = Boolean(process.env.TRAVELPAYOUTS_MARKER);
  return {
    ...leg,
    bookingUrl: url,
    bookingProvider: 'aviasales',
    bookingLabel: hasAffiliateMarker ? 'Affiliate search link' : 'Search booking options',
    bookingNote: hasAffiliateMarker
      ? 'Affiliate link; final checkout price may differ.'
      : 'Search link; compare final checkout price before booking.'
  };
}

function contiguousFlightGroups(legs) {
  const groups = [];
  let current = [];
  for (const leg of legs) {
    const canContinue = current.length > 0 &&
      current.at(-1).destination === leg.origin &&
      !current.at(-1).stayHoursAfter &&
      leg.mode !== 'bus' &&
      leg.origin &&
      leg.destination &&
      leg.departureDate;
    if (!canContinue && current.length > 0) {
      groups.push(current);
      current = [];
    }
    if (leg.mode !== 'bus' && leg.origin && leg.destination && leg.departureDate) {
      current.push(leg);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function buildAviasalesSearchUrlForLegs(legs) {
  try {
    const url = new URL(AVIASALES_SEARCH_BASE_URL);
    const params = new URLSearchParams({
      adults: String(normalizePassengerCount(legs.find((leg) => leg.passengers)?.passengers)),
      children: '0',
      infants: '0',
      trip_class: '0',
      currency: 'USD',
      locale: 'en',
      ...(process.env.TRAVELPAYOUTS_MARKER ? { marker: process.env.TRAVELPAYOUTS_MARKER } : {})
    });
    if (legs.length === 1) {
      params.set('origin_iata', legs[0].origin);
      params.set('destination_iata', legs[0].destination);
      params.set('depart_date', legs[0].departureDate);
      params.set('oneway', '1');
    } else {
      legs.forEach((leg, index) => {
        params.set(`segments[${index}][origin_iata]`, leg.origin);
        params.set(`segments[${index}][destination_iata]`, leg.destination);
        params.set(`segments[${index}][depart_date]`, leg.departureDate);
      });
    }
    url.search = params.toString();
    return url.toString();
  } catch {
    return null;
  }
}

function normalizePassengerCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count)) return 1;
  return Math.min(9, Math.max(1, count));
}
