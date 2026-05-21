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
