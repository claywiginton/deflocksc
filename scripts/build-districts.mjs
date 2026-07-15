#!/usr/bin/env node
/**
 * build-districts.mjs
 * Regenerates the bundled data for the find-your-representative tool from the
 * open-civics + open-civics-boundaries npm packages (MIT, (c) Tim Simpson).
 *
 * Auto-discovers every SC layer that has BOTH a boundary polygon and a roster:
 *   - state House (sldl) + Senate (sldu)
 *   - all counties with council boundaries + rosters (statewide)
 *   - all cities/places with council boundaries + rosters
 *
 * Output: data/districts/*.geojson, data/registry.json, data/reps.json
 * Run: npm run build:districts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";

const NM = path.join(process.cwd(), "node_modules");
const BOUND = path.join(NM, "open-civics-boundaries", "data", "sc", "boundaries");
const ROSTER = path.join(NM, "open-civics", "data", "sc");
if (!existsSync(BOUND) || !existsSync(ROSTER)) {
  console.error("Missing open-civics data. Run `npm install` first."); process.exit(1);
}

const OUT = "data";
const OUT_D = `${OUT}/districts`;
if (existsSync(OUT_D)) rmSync(OUT_D, { recursive: true, force: true });
mkdirSync(OUT_D, { recursive: true });

const load = (f) => JSON.parse(readFileSync(f, "utf8"));
const round = (n) => Math.round(n * 1e5) / 1e5;
const title = (s) => s.replace(/(^|-)([a-z])/g, (_, a, b) => (a ? " " : "") + b.toUpperCase());

function roundCoords(c) { return typeof c[0] === "number" ? [round(c[0]), round(c[1])] : c.map(roundCoords); }
function bboxOf(fc) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  const walk = (x) => { if (typeof x[0] === "number") { a = Math.min(a, x[0]); c = Math.max(c, x[0]); b = Math.min(b, x[1]); d = Math.max(d, x[1]); } else x.forEach(walk); };
  fc.features.forEach((f) => walk(f.geometry.coordinates));
  return [round(a), round(b), round(c), round(d)];
}
function emitBoundary(srcFile, outName) {
  const fc = load(srcFile);
  fc.features.forEach((f) => { f.geometry.coordinates = roundCoords(f.geometry.coordinates); f.properties = { district: String(f.properties.district ?? "") }; });
  const out = { type: "FeatureCollection", features: fc.features };
  writeFileSync(`${OUT_D}/${outName}.geojson`, JSON.stringify(out));
  const districts = new Set(fc.features.map((f) => f.properties.district).filter(Boolean));
  return { bbox: bboxOf(out), count: fc.features.length, districted: districts.size > 1 };
}
function slimMember(m) {
  return { name: m.name, title: m.title || null, email: m.email || null, phone: m.phone || null, website: m.website || null, party: m.party || null, district: String(m.seatId ?? m.district ?? ""), vacant: !!m.vacant };
}
function byDistrict(members) { const o = {}; for (const m of members) { const d = String(m.seatId ?? m.district ?? ""); if (d) o[d] = slimMember(m); } return o; }
function slimChamber(ch) { const o = {}; for (const [d, m] of Object.entries(ch || {})) o[d] = { name: m.name, title: m.title || null, email: m.email || null, phone: m.phone || null, website: m.website || null, party: m.party || null, district: String(m.district ?? d), vacant: !!m.vacant }; return o; }

const boundaryFiles = readdirSync(BOUND).filter((f) => f.endsWith(".json"));
const hasRoster = (rel) => existsSync(path.join(ROSTER, rel));

const registry = { generated: new Date().toISOString().slice(0, 10), layers: [] };
const reps = { generated: registry.generated, state: {}, counties: {}, places: {} };

// ---- state legislative ----
for (const [file, kind, label] of [["sldl.json", "state-house", "SC House"], ["sldu.json", "state-senate", "SC Senate"]]) {
  if (!existsSync(path.join(BOUND, file))) continue;
  const name = file.replace(".json", "");
  const { bbox, count } = emitBoundary(path.join(BOUND, file), name);
  registry.layers.push({ id: name, kind, label, file: `${name}.geojson`, bbox });
  console.log(`state   ${label.padEnd(22)} ${count} districts`);
}
const st = load(path.join(ROSTER, "state.json"));
reps.state = { senate: slimChamber(st.senate), house: slimChamber(st.house) };

// ---- counties (all with boundary + roster) ----
let nCounty = 0;
for (const bf of boundaryFiles.filter((f) => f.startsWith("county-"))) {
  const c = bf.replace("county-", "").replace(".json", "");
  if (!hasRoster(`local/county-${c}.json`)) { console.warn("  skip county (no roster):", c); continue; }
  const name = `county-${c}`;
  const { bbox } = emitBoundary(path.join(BOUND, bf), name);
  const r = load(path.join(ROSTER, `local/county-${c}.json`));
  reps.counties[c] = { label: r.meta?.label || `${title(c)} County Council`, members: byDistrict(r.members) };
  registry.layers.push({ id: name, kind: "county", county: c, label: reps.counties[c].label, file: `${name}.geojson`, bbox });
  nCounty++;
}

// ---- places / cities (all with boundary + roster) ----
let nPlace = 0;
for (const bf of boundaryFiles.filter((f) => f.startsWith("place-"))) {
  const p = bf.replace("place-", "").replace(".json", "");
  if (!hasRoster(`local/place-${p}.json`)) { console.warn("  skip place (no roster):", p); continue; }
  const name = `place-${p}`;
  const { bbox, districted } = emitBoundary(path.join(BOUND, bf), name);
  const r = load(path.join(ROSTER, `local/place-${p}.json`));
  reps.places[p] = { label: r.meta?.label || `City of ${title(p)} Council`, city: title(p), districted, members: byDistrict(r.members), all: r.members.map(slimMember) };
  registry.layers.push({ id: name, kind: "place", place: p, label: reps.places[p].label, districted, file: `${name}.geojson`, bbox });
  nPlace++;
}

writeFileSync(`${OUT}/registry.json`, JSON.stringify(registry));
writeFileSync(`${OUT}/reps.json`, JSON.stringify(reps));
console.log(`\ncounties: ${nCounty} | cities: ${nPlace} (${Object.keys(reps.places).join(", ") || "none"})`);
console.log(`boundary layers: ${registry.layers.length}`);
