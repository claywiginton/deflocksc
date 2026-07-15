#!/usr/bin/env node
/**
 * build-map.mjs — generates data/sc-camera-map.svg: a choropleth of South
 * Carolina counties shaded by the number of mapped ALPR cameras.
 * Source: data/districts/county-*.geojson (boundaries) + data/camera-counts.json.
 * Run: npm run build:map  (after build:districts)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const reg = JSON.parse(readFileSync("data/registry.json", "utf8"));
const cams = JSON.parse(readFileSync("data/camera-counts.json", "utf8"));
const counties = reg.layers.filter((l) => l.kind === "county");

// global bbox across all county polygons
let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
const geo = {};
for (const c of counties) {
  const fc = JSON.parse(readFileSync("data/districts/" + c.file, "utf8"));
  geo[c.county] = fc;
  const walk = (x) => { if (typeof x[0] === "number") { minLng = Math.min(minLng, x[0]); maxLng = Math.max(maxLng, x[0]); minLat = Math.min(minLat, x[1]); maxLat = Math.max(maxLat, x[1]); } else x.forEach(walk); };
  fc.features.forEach((f) => walk(f.geometry.coordinates));
}
const midLat = (minLat + maxLat) / 2;
const kx = Math.cos((midLat * Math.PI) / 180);
const geoW = (maxLng - minLng) * kx, geoH = maxLat - minLat;
const W = 1000, H = Math.round((W * geoH) / geoW);
const px = (lng) => +(((lng - minLng) * kx) / geoW * W).toFixed(1);
const py = (lat) => +(((maxLat - lat) / geoH) * H).toFixed(1);

function ringPath(ring) { return "M" + ring.map((p) => px(p[0]) + "," + py(p[1])).join("L") + "Z"; }
function geomPath(g) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.map((poly) => poly.map(ringPath).join("")).join("");
}
function color(n) {
  if (!n) return "#ECE4D4";
  if (n < 10) return "#E3C6A0";
  if (n < 25) return "#D89A63";
  if (n < 50) return "#C56A43";
  if (n < 100) return "#A83A38";
  return "#7A1E28";
}

let paths = "";
for (const c of counties) {
  const n = cams["county:" + c.county] || 0;
  const name = (c.label || "").replace(/ Council$/, "");
  let d = "";
  geo[c.county].features.forEach((f) => { d += geomPath(f.geometry); });
  paths += '<path d="' + d + '" fill="' + color(n) + '" stroke="#F7F5EF" stroke-width="0.6" stroke-linejoin="round"><title>' + name + ' — ' + n + ' ALPR camera' + (n === 1 ? "" : "s") + ' mapped</title></path>\n';
}

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
  'aria-label="Map of South Carolina counties shaded by number of mapped ALPR cameras">\n' +
  '<rect width="' + W + '" height="' + H + '" fill="none"/>\n' + paths + '</svg>\n';

writeFileSync("data/sc-camera-map.svg", svg);
console.log(`sc-camera-map.svg: ${counties.length} counties, ${W}x${H}, ${(svg.length / 1024).toFixed(0)}KB`);
