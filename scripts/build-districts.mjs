#!/usr/bin/env node
/**
 * build-districts.mjs
 * Regenerates the bundled data for the find-your-representative tool from the
 * open-civics + open-civics-boundaries npm packages (MIT, (c) Tim Simpson).
 *
 * Scope: Upstate SC county/city councils + statewide legislators.
 * Output: data/districts/*.geojson, data/registry.json, data/reps.json
 *
 * Run: npm run build:districts   (also runs in CI to keep the data fresh)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const NM = path.join(process.cwd(), "node_modules");
const BOUND = path.join(NM, "open-civics-boundaries", "data", "sc", "boundaries");
const ROSTER = path.join(NM, "open-civics", "data", "sc");
if (!existsSync(BOUND) || !existsSync(ROSTER)) {
  console.error("Missing open-civics data. Run `npm install` first."); process.exit(1);
}

// Upstate counties (council levers + region focus)
const UPSTATE = [
  "greenville", "spartanburg", "anderson", "pickens", "oconee",
  "laurens", "cherokee", "union", "greenwood", "abbeville", "newberry",
];
// Upstate cities that have boundary polygons available (only these can be point-matched)
const PLACES = ["greenville"];

const OUT = "data";
const OUT_D = `${OUT}/districts`;
if (existsSync(OUT_D)) rmSync(OUT_D, { recursive: true, force: true });
mkdirSync(OUT_D, { recursive: true });

const load = (f) => JSON.parse(readFileSync(f, "utf8"));
const round = (n) => Math.round(n * 1e5) / 1e5; // ~1m precision, shrinks files

function roundCoords(c) {
  if (typeof c[0] === "number") return [round(c[0]), round(c[1])];
  return c.map(roundCoords);
}
function bboxOf(fc) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      minLng = Math.min(minLng, c[0]); maxLng = Math.max(maxLng, c[0]);
      minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]);
    } else c.forEach(walk);
  };
  fc.features.forEach((f) => walk(f.geometry.coordinates));
  return [round(minLng), round(minLat), round(maxLng), round(maxLat)];
}
function emitBoundary(srcFile, outName) {
  const fc = load(srcFile);
  fc.features.forEach((f) => { f.geometry.coordinates = roundCoords(f.geometry.coordinates); });
  // keep only the district property
  fc.features.forEach((f) => { f.properties = { district: String(f.properties.district ?? "") }; });
  const out = { type: "FeatureCollection", features: fc.features };
  writeFileSync(`${OUT_D}/${outName}.geojson`, JSON.stringify(out));
  return { bbox: bboxOf(fc), count: fc.features.length };
}

const registry = { generated: new Date().toISOString().slice(0, 10), layers: [] };

// ---- state legislative ----
for (const [file, kind, label] of [
  ["sldl.json", "state-house", "SC House of Representatives"],
  ["sldu.json", "state-senate", "SC Senate"],
]) {
  const src = `${BOUND}/${file}`;
  if (!existsSync(src)) { console.warn("skip missing", file); continue; }
  const name = file.replace(".json", "");
  const { bbox, count } = emitBoundary(src, name);
  registry.layers.push({ id: name, kind, label, file: `${name}.geojson`, bbox });
  console.log(`state  ${label.padEnd(28)} ${count} districts`);
}

// ---- Upstate county councils ----
for (const c of UPSTATE) {
  const src = `${BOUND}/county-${c}.json`;
  if (!existsSync(src)) { console.warn("skip missing county boundary", c); continue; }
  const name = `county-${c}`;
  const { bbox, count } = emitBoundary(src, name);
  registry.layers.push({ id: name, kind: "county", county: c, label: `${title(c)} County Council`, file: `${name}.geojson`, bbox });
  console.log(`county ${title(c).padEnd(28)} ${count} districts`);
}

// ---- Upstate city councils (only those with boundaries) ----
for (const pl of PLACES) {
  const src = `${BOUND}/place-${pl}.json`;
  if (!existsSync(src)) { console.warn("skip missing place boundary", pl); continue; }
  const name = `place-${pl}`;
  const { bbox, count } = emitBoundary(src, name);
  registry.layers.push({ id: name, kind: "place", place: pl, label: `City of ${title(pl)} Council`, file: `${name}.geojson`, bbox });
  console.log(`place  ${title(pl).padEnd(28)} ${count} features`);
}

// ---- rosters ----
const reps = { generated: registry.generated, state: {}, counties: {}, places: {} };
const stateRoster = load(`${ROSTER}/state.json`);
reps.state = {
  senate: slimChamber(stateRoster.senate),
  house: slimChamber(stateRoster.house),
};
for (const c of UPSTATE) {
  const f = `${ROSTER}/local/county-${c}.json`;
  if (!existsSync(f)) { console.warn("skip missing county roster", c); continue; }
  const r = load(f);
  reps.counties[c] = { label: r.meta?.label || `${title(c)} County Council`, members: byDistrict(r.members) };
}
for (const pl of PLACES) {
  const f = `${ROSTER}/local/place-${pl}.json`;
  if (!existsSync(f)) { console.warn("skip missing place roster", pl); continue; }
  const r = load(f);
  reps.places[pl] = { label: r.meta?.label || `City of ${title(pl)} Council`, members: byDistrict(r.members), all: r.members.map(slimMember) };
}

writeFileSync(`${OUT}/registry.json`, JSON.stringify(registry, null, 0));
writeFileSync(`${OUT}/reps.json`, JSON.stringify(reps));
console.log(`\nwrote ${registry.layers.length} boundary layers -> ${OUT_D}/`);
console.log(`rosters: state (senate+house) + ${Object.keys(reps.counties).length} counties + ${Object.keys(reps.places).length} cities`);

// ---- helpers ----
function slimMember(m) {
  return {
    name: m.name, title: m.title || null, email: m.email || null, phone: m.phone || null,
    website: m.website || null, party: m.party || null, district: String(m.seatId ?? m.district ?? ""),
    vacant: !!m.vacant,
  };
}
function byDistrict(members) {
  const o = {};
  for (const m of members) { const d = String(m.seatId ?? m.district ?? ""); if (d) o[d] = slimMember(m); }
  return o;
}
function slimChamber(ch) {
  const o = {};
  for (const [d, m] of Object.entries(ch || {})) {
    o[d] = {
      name: m.name, title: m.title || null, email: m.email || null, phone: m.phone || null,
      website: m.website || null, party: m.party || null, district: String(m.district ?? d), vacant: !!m.vacant,
    };
  }
  return o;
}
function title(s) { return s.replace(/(^|-)([a-z])/g, (_, a, b) => (a ? " " : "") + b.toUpperCase()); }
