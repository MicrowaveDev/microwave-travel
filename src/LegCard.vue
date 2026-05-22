<script setup>
// One numbered route-leg card: header (cities + price), IATA strip with
// duration/mode, airline + baggage chips, and a collapsed baggage-details
// panel. Receives index/leg/pricedLeg/booking/priceError as props; no
// global state. See AGENTS.md "Module Map".
import { computed } from 'vue';
import {
  elapsedMinutes,
  estimateLayoverMinutes,
  formatMinutesLabel,
  totalLayoverMinutes
} from './lib/leg-time.js';

const props = defineProps({
  index: { type: Number, required: true },
  leg: { type: Object, required: true },
  pricedLeg: { type: Object, default: null },
  booking: { type: Object, default: null },
  priceError: { type: String, default: '' }
});

const price = computed(() => {
  const amount = props.pricedLeg?.amount;
  return typeof amount === 'number' ? `$${amount.toLocaleString()}` : null;
});

const provider = computed(() => props.pricedLeg?.provider || null);

const airline = computed(() => {
  const priced = props.pricedLeg;
  if (!priced?.airline && !priced?.carrier) return null;
  const label = priced.airline?.code
    ? `${priced.airline.name} (${priced.airline.code})`
    : priced.airline?.name || priced.carrier;
  return { label, website: priced.airline?.website || null };
});

const baggageSummary = computed(() => props.pricedLeg?.baggageAllowance?.summary || null);

const baggageChips = computed(() => {
  const allowance = props.pricedLeg?.baggageAllowance;
  if (!allowance) return [];
  const chips = [];
  for (const detail of allowance.details || []) {
    const match = /^(Cabin|Checked):\s*(.+)$/i.exec(String(detail));
    if (!match) continue;
    chips.push({
      label: match[1],
      text: shortenBaggageDetail(match[2].trim()),
      state: baggageChipState(match[2].trim())
    });
  }
  if (!chips.length && allowance.fareType) {
    chips.push({ label: 'Fare', text: capitalize(allowance.fareType), state: 'info' });
  }
  return chips;
});

const originCode = computed(() => props.pricedLeg?.origin || cityCodeFallback(props.leg?.from));
const destinationCode = computed(() => props.pricedLeg?.destination || cityCodeFallback(props.leg?.to));
const totalDurationMinutes = computed(() => {
  const elapsed = elapsedMinutes(props.pricedLeg?.departureAt, props.pricedLeg?.arrivalAt);
  if (Number.isFinite(elapsed) && elapsed > 0) return elapsed;
  const hours = Number(props.leg?.hours);
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : 0;
});
const durationLabel = computed(() => formatMinutesLabel(totalDurationMinutes.value));
const stopCount = computed(() => {
  const value = Number(props.pricedLeg?.stopCount);
  return Number.isFinite(value) && value > 0 ? value : 0;
});
const layoverDetail = computed(() => {
  if (stopCount.value === 0) return null;
  const precise = totalLayoverMinutes(props.pricedLeg?.flightSegments);
  if (Number.isFinite(precise) && precise > 0) {
    return { minutes: precise, estimated: false };
  }
  const estimate = estimateLayoverMinutes(totalDurationMinutes.value, props.leg?.distanceKm);
  if (Number.isFinite(estimate) && estimate > 0) {
    return { minutes: estimate, estimated: true };
  }
  return null;
});
const modeLabel = computed(() => {
  if (props.leg?.mode === 'bus') return 'Bus';
  if (props.leg?.mode === 'train') return 'Train';
  if (stopCount.value === 0) return 'Direct';
  const stops = `${stopCount.value} stop${stopCount.value === 1 ? '' : 's'}`;
  const layover = layoverDetail.value
    ? ` (${layoverDetail.value.estimated ? '~' : ''}${formatMinutesLabel(layoverDetail.value.minutes)})`
    : '';
  return `${hubPrefix.value}${stops}${layover}`;
});
const hubPrefix = computed(() => {
  const code = props.pricedLeg?.hubCode;
  if (!code) return '';
  const label = props.pricedLeg?.hubLabel;
  const display = label ? `${label} (${code})` : code;
  return props.pricedLeg?.hubInferred ? `Likely via ${display} · ` : `Via ${display} · `;
});
const arrivesLater = computed(() =>
  Boolean(props.leg?.arriveBy && props.leg?.departOn && props.leg.arriveBy !== props.leg.departOn)
);
const departLabel = computed(() => formatLegDate(props.leg?.departOn));
const arriveLabel = computed(() => formatLegDate(props.leg?.arriveBy));
const departTimeLabel = computed(() => formatLegTime(props.pricedLeg?.departureAt));
const arriveTimeLabel = computed(() => formatLegTime(props.pricedLeg?.arrivalAt));
const reliabilityPercent = computed(() => Math.round((props.leg?.reliability ?? 0) * 100));

function cityCodeFallback(city) {
  const value = String(city || '').trim();
  if (!value) return '';
  if (/^[A-Z]{2,4}$/.test(value)) return value;
  const letters = value.replace(/[^A-Za-z]/g, '');
  return letters.slice(0, 3).toUpperCase();
}

function formatLegDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatLegTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  // Render the time in the timestamp's original zone — provider ISO
  // strings carry departure-local time (e.g. "2026-05-21T13:30:00+01:00"),
  // and travel times are most useful in the city's local time.
  const match = /T(\d{2}):(\d{2})/.exec(String(value));
  return match ? `${match[1]}:${match[2]}` : '';
}

function shortenBaggageDetail(text) {
  const trimmed = String(text).replace(/\s+/g, ' ').trim();
  if (trimmed.length <= 38) return trimmed;
  return `${trimmed.slice(0, 36).trim()}…`;
}

function baggageChipState(text) {
  const lower = String(text).toLowerCase();
  if (/not included|not allowed|n\/a/.test(lower)) return 'excluded';
  if (/depends|varies|may need|extra|paid|purchase|add-on/.test(lower)) return 'optional';
  return 'included';
}

function capitalize(value) {
  const str = String(value || '');
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
</script>

<template>
  <article class="leg-card">
    <div class="leg-index">{{ index + 1 }}</div>
    <div class="leg-body">
      <header class="leg-header">
        <h2>{{ leg.from }} <span class="leg-arrow" aria-hidden="true">→</span> {{ leg.to }}</h2>
        <div class="leg-price-block">
          <span v-if="price" class="leg-price">{{ price }}</span>
          <span v-if="price && provider" class="leg-price-provider">via {{ provider }}</span>
          <span v-if="!price && priceError" class="leg-price-missing">{{ priceError }}</span>
        </div>
      </header>

      <div class="leg-strip" :class="{ 'is-bus': leg.mode === 'bus' }">
        <div class="leg-strip-end">
          <span class="leg-code">{{ originCode }}</span>
          <span class="leg-city">{{ leg.from }}</span>
          <span class="leg-date">
            <span v-if="departTimeLabel" class="leg-time">{{ departTimeLabel }} · </span>{{ departLabel }}
          </span>
        </div>
        <div class="leg-strip-middle">
          <span class="leg-duration">{{ durationLabel }} · {{ modeLabel }}</span>
          <span class="leg-strip-line" aria-hidden="true">
            <span class="leg-strip-dot leg-strip-dot--start"></span>
            <span class="leg-strip-icon">{{ leg.mode === 'bus' ? '⇢' : '✈' }}</span>
            <span class="leg-strip-dot leg-strip-dot--end"></span>
          </span>
          <span class="leg-distance">{{ leg.distanceKm.toLocaleString() }} km</span>
        </div>
        <div class="leg-strip-end leg-strip-end--arrival">
          <span class="leg-code">{{ destinationCode }}</span>
          <span class="leg-city">{{ leg.to }}</span>
          <span class="leg-date">
            <span v-if="arriveTimeLabel" class="leg-time">{{ arriveTimeLabel }} · </span>{{ arriveLabel }}
            <span v-if="arrivesLater" class="leg-overnight" title="Arrives on a later day">+1</span>
          </span>
        </div>
      </div>

      <div v-if="airline || baggageChips.length || booking" class="leg-chips">
        <span v-if="airline" class="leg-chip leg-chip--airline">
          <span class="leg-chip-label">Airline</span>
          <a
            v-if="airline.website"
            :href="airline.website"
            target="_blank"
            rel="noreferrer"
          >{{ airline.label }}</a>
          <span v-else>{{ airline.label }}</span>
        </span>
        <span
          v-for="chip in baggageChips"
          :key="`${index}-${chip.label}`"
          class="leg-chip"
          :class="`leg-chip--${chip.state}`"
        >
          <span class="leg-chip-label">{{ chip.label }}</span>
          <span class="leg-chip-text">{{ chip.text }}</span>
        </span>
        <a
          v-if="booking"
          class="booking-link"
          :href="booking.bookingUrl"
          target="_blank"
          rel="noreferrer"
          :title="booking.bookingNote"
        >
          {{ booking.bookingLabel }}
        </a>
      </div>

      <details v-if="baggageSummary" class="leg-details">
        <summary>Baggage details</summary>
        <p class="leg-baggage">Bags: {{ baggageSummary }}</p>
        <small>{{ leg.note }} Reliability {{ reliabilityPercent }}%.</small>
      </details>
      <small v-else class="leg-note">{{ leg.note }} Reliability {{ reliabilityPercent }}%.</small>
    </div>
  </article>
</template>

<style scoped>
.leg-card {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 12px;
  border: 1px solid #d8e0df;
  border-radius: 8px;
  padding: 12px;
  background: #ffffff;
}

.leg-index {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 50%;
  color: #ffffff;
  background: #e25f3c;
  font-size: 0.9rem;
  font-weight: 900;
}

.leg-card h2 {
  margin: 0;
  color: #172026;
  font-size: 1rem;
}

.leg-card p,
.leg-card small {
  margin: 0;
  color: #5d6f77;
  font-size: 0.9rem;
}

.leg-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.leg-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.leg-arrow {
  color: #8aa1a8;
  font-weight: 700;
  padding: 0 4px;
}

.leg-price-block {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.leg-price {
  color: #0f766e;
  font-size: 1.35rem;
  font-weight: 900;
  line-height: 1;
}

.leg-price-provider {
  color: #6a7d83;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.leg-price-missing {
  color: #7a4a00;
  font-size: 0.85rem;
  font-weight: 800;
}

.leg-strip {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(120px, 1fr) minmax(0, auto);
  align-items: center;
  gap: 12px;
  padding: 10px 8px;
  border-radius: 10px;
  background: #f5f9f8;
}

.leg-strip.is-bus {
  background: #fbf5ef;
}

.leg-strip-end {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.leg-strip-end--arrival {
  text-align: right;
  align-items: flex-end;
}

.leg-code {
  font-size: 1.25rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  color: #172026;
  line-height: 1.1;
}

.leg-city {
  color: #40545c;
  font-size: 0.86rem;
  font-weight: 700;
}

.leg-date {
  color: #6a7d83;
  font-size: 0.78rem;
  font-weight: 600;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}

.leg-time {
  color: #172026;
  font-weight: 800;
}

.leg-overnight {
  display: inline-block;
  padding: 0 6px;
  border-radius: 999px;
  background: #fde6c8;
  color: #7a4a00;
  font-size: 0.7rem;
  font-weight: 800;
}

.leg-strip-middle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.leg-duration {
  color: #0f5d57;
  font-size: 0.82rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.leg-strip-line {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 80px;
  height: 14px;
}

.leg-strip-line::before {
  content: '';
  position: absolute;
  inset: 50% 6px auto;
  height: 2px;
  border-top: 2px dashed #b8d6d2;
  transform: translateY(-1px);
}

.leg-strip.is-bus .leg-strip-line::before {
  border-top-color: #d8b896;
}

.leg-strip-dot {
  position: relative;
  z-index: 1;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #0f5d57;
}

.leg-strip.is-bus .leg-strip-dot {
  background: #a3672a;
}

.leg-strip-icon {
  position: relative;
  z-index: 1;
  padding: 0 6px;
  background: #f5f9f8;
  color: #0f5d57;
  font-size: 0.95rem;
  line-height: 1;
}

.leg-strip.is-bus .leg-strip-icon {
  background: #fbf5ef;
  color: #a3672a;
}

.leg-distance {
  color: #6a7d83;
  font-size: 0.74rem;
  font-weight: 600;
}

.leg-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.leg-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eef3f2;
  color: #2c3a3f;
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1.4;
}

.leg-chip-label {
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 0.7rem;
  color: #5d6f77;
}

.leg-chip--airline {
  background: #e8edf0;
  color: #233037;
}

.leg-chip--airline a {
  color: #0f5d57;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  font-weight: 800;
}

.leg-chip--included {
  background: #e2f3ed;
  color: #0f5d57;
}

.leg-chip--included .leg-chip-label {
  color: #0f766e;
}

.leg-chip--optional {
  background: #fdeed4;
  color: #7a4a00;
}

.leg-chip--optional .leg-chip-label {
  color: #a35d00;
}

.leg-chip--excluded {
  background: #f4e1de;
  color: #843022;
}

.leg-chip--excluded .leg-chip-label {
  color: #9c3a2a;
}

.leg-details {
  margin-top: 2px;
}

.leg-details > summary {
  cursor: pointer;
  color: #0f5d57;
  font-size: 0.82rem;
  font-weight: 700;
  list-style: none;
  user-select: none;
}

.leg-details > summary::-webkit-details-marker {
  display: none;
}

.leg-details > summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 4px;
  transition: transform 0.15s ease;
}

.leg-details[open] > summary::before {
  transform: rotate(90deg);
}

.leg-details > * + * {
  margin-top: 4px;
}

.leg-note {
  display: block;
  margin-top: 4px;
  color: #6a7d83;
}

.leg-airline {
  color: #40545c;
  font-weight: 700;
}

.leg-airline a {
  color: #0f5d57;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

.leg-baggage {
  color: #40545c;
  font-weight: 600;
}

.booking-link {
  display: inline-flex;
  align-items: center;
  border: 1px solid #b8d6d2;
  border-radius: 999px;
  padding: 4px 10px;
  color: #0f5d57;
  background: #edf8f6;
  font-size: 0.78rem;
  font-weight: 800;
  text-decoration: none;
}

.booking-link:hover {
  border-color: #0f766e;
  background: #dcefed;
}

@media (max-width: 520px) {
  .leg-strip {
    grid-template-columns: 1fr;
    gap: 6px;
    padding: 10px;
  }

  .leg-strip-end--arrival {
    text-align: left;
    align-items: flex-start;
  }

  .leg-strip-middle {
    flex-direction: row;
    justify-content: space-between;
    width: 100%;
  }

  .leg-strip-line {
    flex: 1;
    margin: 0 8px;
  }
}
</style>
