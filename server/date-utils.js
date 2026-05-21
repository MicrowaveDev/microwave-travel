export function addDaysToDateString(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) return date;
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

export function dateWindow(startDate, days) {
  return Array.from({ length: days }, (_, index) => addDaysToDateString(startDate, index));
}

export function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

export function formatDateShift(offsetDays) {
  if (!offsetDays) return '';
  return ` (${offsetDays > 0 ? '+' : ''}${offsetDays}d flex)`;
}

export function popularRouteDateChoices(startDate, startIndex, searchDays, flexDays) {
  if (startIndex !== 0) {
    return dateWindow(startDate, searchDays).map((date) => ({ date, offsetDays: daysBetween(startDate, date) }));
  }

  const offsets = [0];
  for (let days = 1; days <= flexDays; days += 1) {
    offsets.push(days, -days);
  }
  return offsets.map((offsetDays) => ({
    date: addDaysToDateString(startDate, offsetDays),
    offsetDays
  }));
}

export function shiftDisplayLegDates(legs, offsetDays) {
  if (!offsetDays) return legs;
  return legs.map((leg) => ({
    ...leg,
    departOn: leg.departOn ? addDaysToDateString(leg.departOn, offsetDays) : leg.departOn,
    arriveBy: leg.arriveBy ? addDaysToDateString(leg.arriveBy, offsetDays) : leg.arriveBy
  }));
}
