// Shared money + date arithmetic used by the route-optimization brain
// and the quote normalizer. roundMoney is the canonical way to round
// prices before storing/displaying them (2 decimals, banker's rounding
// avoided in favor of Math.round).

export function addHoursToDate(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function formatStayDays(days) {
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} day${rounded === 1 ? '' : 's'}`;
}

export function roundMoney(value) {
  return Math.round(value * 100) / 100;
}
