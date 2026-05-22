// Time helpers shared by LegCard.vue. Pure: ISO-string in → label or
// number out. elapsedMinutes is the canonical departure→arrival duration
// in minutes; totalLayoverMinutes sums the gaps between consecutive
// flightSegments when the provider exposes them.

export function formatMinutesLabel(minutes) {
  const total = Math.round(Number(minutes));
  if (!Number.isFinite(total) || total <= 0) return '';
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function elapsedMinutes(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const minutes = Math.round((end - start) / 60000);
  return minutes > 0 ? minutes : null;
}

export function totalLayoverMinutes(segments) {
  if (!Array.isArray(segments) || segments.length < 2) return null;
  let total = 0;
  for (let index = 1; index < segments.length; index += 1) {
    const gap = elapsedMinutes(segments[index - 1]?.arrivingAt, segments[index]?.departingAt);
    if (!Number.isFinite(gap) || gap <= 0) return null;
    total += gap;
  }
  return total;
}

// Rough layover estimate for providers that don't return per-segment
// timings (Aviasales): total trip time minus flight time approximated
// from great-circle distance and a typical commercial cruise speed.
// Returns null when inputs are missing or the result is too small to
// be meaningful (< 30 min). Caller should label this with `~` so it's
// not mistaken for a precise number.
const AVG_FLIGHT_KMH = 800;
const MIN_LAYOVER_TO_DISPLAY = 30;

export function estimateLayoverMinutes(totalMinutes, distanceKm) {
  const total = Number(totalMinutes);
  const distance = Number(distanceKm);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(distance) || distance <= 0) return null;
  const flightMinutes = (distance / AVG_FLIGHT_KMH) * 60;
  const layover = Math.round(total - flightMinutes);
  return layover >= MIN_LAYOVER_TO_DISPLAY ? layover : null;
}
