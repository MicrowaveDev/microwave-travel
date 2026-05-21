#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { airlineInfoForCarrier, normalizeCarrierCode } from '../server/airlines.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = resolve(rootDir, 'data/baggage-allowances.json');

const [, , command, ...args] = process.argv;
const flags = parseFlags(args);

if (!command || ['help', '--help', '-h'].includes(command)) {
  printHelp();
  process.exit(0);
}

if (command === 'lookup') {
  const data = readData();
  const carrier = requireCarrier(flags);
  const fareType = normalizeFareType(flags.fare || flags.fareType || '');
  const entries = data.entries.filter((entry) => entry.carrier === carrier);
  const entry = fareType
    ? entries.find((candidate) => normalizeFareType(candidate.fareType) === fareType)
    : entries[0];
  if (!entry) {
    const airline = airlineInfoForCarrier(carrier);
    console.log(`No local baggage entry for ${carrier}.`);
    console.log(`Airline site: ${airline?.website || 'unknown'}`);
    console.log(`Add it after checking official rules:`);
    console.log(`node scripts/baggage-allowance.js add --carrier ${carrier} --fare basic --summary "..." --cabin "..." --checked "..." --url "${airline?.website || 'https://...'}"`);
    process.exit(1);
  }
  console.log(`${entry.carrier} ${entry.fareType}`);
  console.log(entry.summary);
  console.log(`Cabin: ${entry.cabin || 'unknown'}`);
  console.log(`Checked: ${entry.checked || 'unknown'}`);
  console.log(`Source: ${entry.sourceUrl || 'missing'}`);
  if (entry.notes) console.log(`Notes: ${entry.notes}`);
  process.exit(0);
}

if (command === 'add') {
  const carrier = requireCarrier(flags);
  const fareType = requireValue(flags.fare || flags.fareType, '--fare');
  const summary = requireValue(flags.summary, '--summary');
  const sourceUrl = requireValue(flags.url || flags.sourceUrl, '--url');
  const data = readData();
  const entry = {
    carrier,
    fareType: normalizeFareType(fareType) || fareType,
    summary,
    cabin: flags.cabin || '',
    checked: flags.checked || '',
    sourceUrl,
    updatedAt: new Date().toISOString().slice(0, 10),
    notes: flags.notes || 'Verify the exact fare rules before booking.'
  };
  const nextEntries = data.entries.filter((candidate) =>
    !(candidate.carrier === entry.carrier && normalizeFareType(candidate.fareType) === normalizeFareType(entry.fareType))
  );
  nextEntries.push(entry);
  nextEntries.sort((a, b) => `${a.carrier}|${a.fareType}`.localeCompare(`${b.carrier}|${b.fareType}`));
  writeData({ ...data, updatedAt: entry.updatedAt, entries: nextEntries });
  console.log(`Saved ${entry.carrier} ${entry.fareType} baggage allowance.`);
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
printHelp();
process.exit(1);

function parseFlags(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith('--')) continue;
    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    parsed[rawKey] = inlineValue ?? values[index + 1] ?? '';
    if (inlineValue === undefined) index += 1;
  }
  return parsed;
}

function requireCarrier(values) {
  const carrier = normalizeCarrierCode(requireValue(values.carrier, '--carrier'));
  if (!carrier) throw new Error('--carrier must be a two-character IATA carrier code, for example PC');
  return carrier;
}

function requireValue(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function readData() {
  return JSON.parse(readFileSync(dataPath, 'utf8'));
}

function writeData(data) {
  writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`);
}

function normalizeFareType(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function printHelp() {
  console.log(`Usage:
  node scripts/baggage-allowance.js lookup --carrier PC [--fare light]
  node scripts/baggage-allowance.js add --carrier PC --fare light --summary "..." --cabin "..." --checked "..." --url "https://..."

Agent flow:
  1. Use lookup with the carrier/fare shown in the UI.
  2. If missing, open the official airline site printed by lookup.
  3. Add the rule with --url pointing to the official baggage/fare-family page.
  4. Run npm test before committing.`);
}
