export function buildSkippedRouteOption({ route, departureDate, reason, message, details = {} }) {
  return {
    route,
    departureDate,
    reason,
    message,
    details
  };
}

export function compactRouteOptions(options) {
  const completeKeys = new Set(options
    .filter((option) => Number.isFinite(option.totalAmount))
    .map(routeOptionCompactKey));
  const partialRouteCounts = new Map();
  const compacted = [];
  for (const option of options) {
    const key = routeOptionCompactKey(option);
    if (!Number.isFinite(option.totalAmount) && completeKeys.has(key)) continue;
    if (!Number.isFinite(option.totalAmount)) {
      const routeKey = option.route.join(' -> ');
      const count = partialRouteCounts.get(routeKey) || 0;
      if (count >= 2) continue;
      partialRouteCounts.set(routeKey, count + 1);
    }
    compacted.push(option);
  }
  return compacted.slice(0, 40);
}

export function formatStayFlex(stayFlexDays, city) {
  return stayFlexDays ? `, +${stayFlexDays}d in ${city}` : '';
}

export function formatCandidatePrice(option) {
  if (Number.isFinite(option?.totalAmount)) return `$${option.totalAmount.toLocaleString()} USD total`;
  if (Number.isFinite(option?.amount)) return `$${option.amount.toLocaleString()} USD transfer`;
  return 'partial price';
}

function routeOptionCompactKey(option) {
  return [
    option.route.join(' -> '),
    option.departureDate,
    option.dateShiftDays || 0,
    option.stayFlexDays || 0,
    option.amount || ''
  ].join('|');
}
