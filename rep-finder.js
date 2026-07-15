/*
 * rep-finder.js — address / geolocation -> your SC state, county & city officials
 * Runs entirely in the browser; the visitor's address is never sent to this site.
 *
 * District boundaries & rosters: open-civics and open-civics-boundaries
 *   (MIT, (c) 2026 Tim Simpson) — https://www.npmjs.com/package/open-civics
 * Point-in-polygon logic adapted from the DeflockSC project
 *   (MIT, (c) 2026 Tim Simpson) — https://github.com/TimSimpsonJr/deflocksc-website
 * Address geocoding: OpenStreetMap Nominatim (c) OpenStreetMap contributors, ODbL.
 */
(function () {
  "use strict";

  var SC_BBOX = [-83.36, 32.03, -78.55, 35.22]; // lng/lat min/max
  var registry = null, reps = null, cameras = null, geoCache = {};

  var form = document.getElementById("rfForm");
  if (!form) return; // widget not on this page
  var addr = document.getElementById("rfAddr");
  var geoBtn = document.getElementById("rfGeo");
  var statusEl = document.getElementById("rfStatus");
  var resultsEl = document.getElementById("rfResults");

  function setStatus(msg, isErr) {
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("err", !!isErr);
  }

  function loadJSON(url) {
    return fetch(url, { credentials: "omit" }).then(function (r) {
      if (!r.ok) throw new Error("Could not load " + url);
      return r.json();
    });
  }
  function ensureData() {
    if (registry && reps) return Promise.resolve();
    return Promise.all([
      loadJSON("data/registry.json"),
      loadJSON("data/reps.json"),
      loadJSON("data/camera-counts.json").catch(function () { return null; }),
    ]).then(function (a) { registry = a[0]; reps = a[1]; cameras = a[2]; });
  }
  function loadLayer(file) {
    if (geoCache[file]) return Promise.resolve(geoCache[file]);
    return loadJSON("data/districts/" + file).then(function (fc) { geoCache[file] = fc; return fc; });
  }

  /* ---- geometry (ray casting) ---- */
  function pointInRing(lat, lng, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      var hit = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }
  function pointInPolygon(lat, lng, geom) {
    if (!geom) return false;
    var polys = geom.type === "Polygon" ? [geom.coordinates]
      : geom.type === "MultiPolygon" ? geom.coordinates : [];
    for (var p = 0; p < polys.length; p++) {
      var rings = polys[p];
      if (pointInRing(lat, lng, rings[0])) {
        var inHole = false;
        for (var h = 1; h < rings.length; h++) { if (pointInRing(lat, lng, rings[h])) { inHole = true; break; } }
        if (!inHole) return true;
      }
    }
    return false;
  }
  function inBBox(lat, lng, b) { return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3]; }

  function findDistrict(fc, lat, lng) {
    for (var i = 0; i < fc.features.length; i++) {
      if (pointInPolygon(lat, lng, fc.features[i].geometry)) return String(fc.features[i].properties.district);
    }
    return null;
  }

  /* ---- geocoding (Nominatim; CORS-friendly, keyless) ---- */
  function geocode(q) {
    var query = /\b(sc|south carolina)\b/i.test(q) ? q : q + ", South Carolina";
    var url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&addressdetails=0&q=" + encodeURIComponent(query);
    return fetch(url, { headers: { "Accept": "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("geocode failed"); return r.json(); })
      .then(function (j) { if (!j || !j.length) throw new Error("no match"); return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) }; });
  }

  /* ---- matching ---- */
  function matchAll(lat, lng) {
    var out = { state: {}, county: null, city: null, countyId: null };
    var jobs = [];
    registry.layers.forEach(function (layer) {
      if (!inBBox(lat, lng, layer.bbox)) return;
      jobs.push(loadLayer(layer.file).then(function (fc) {
        var d = findDistrict(fc, lat, lng);
        if (d == null) return;
        if (layer.kind === "state-senate") out.state.senate = withDistrict(reps.state.senate[d], d, "senate");
        else if (layer.kind === "state-house") out.state.house = withDistrict(reps.state.house[d], d, "house");
        else if (layer.kind === "county") { out.countyId = layer.county; var c = reps.counties[layer.county]; out.county = { label: c && c.label, rep: withDistrict(c && c.members[d], d, "county") }; }
        else if (layer.kind === "place") {
          var pl = reps.places[layer.place]; if (!pl) return;
          var cityReps;
          if (pl.districted && pl.members[d]) cityReps = [tagCity(pl.members[d], d, pl.city)];
          else cityReps = (pl.all || []).map(function (m) { return tagCity(m, m.district, pl.city); });
          out.city = { label: pl.label, reps: cityReps };
        }
      }));
    });
    return Promise.all(jobs).then(function () { return out; });
  }
  function withDistrict(rep, d, level) {
    if (!rep) return { vacant: true, district: d, level: level, name: null };
    return Object.assign({ level: level }, rep, { district: rep.district || d });
  }
  function tagCity(rep, d, cityName) {
    if (!rep) return { level: "city", vacant: true, district: d, cityName: cityName, name: null };
    return Object.assign({ level: "city", cityName: cityName }, rep, { district: rep.district || d });
  }

  /* ---- email drafting ---- */
  function esc(s) { return encodeURIComponent(s); }
  function draft(rep) {
    var name = rep.name || "Representative";
    var s, b;
    if (rep.level === "county") {
      s = "Please put ALPR surveillance oversight on the agenda";
      b = "Dear " + name + ",\n\nI'm a resident of your district (" + (rep.districtLabel || ("District " + rep.district)) + "). There are now more than 400 automated license-plate reader cameras across the Upstate logging where every driver goes — with no public vote, no warrant requirement, and no published rules on who can search the data.\n\nI'm asking the Council to adopt an ALPR oversight ordinance: a public vote before any program, a warrant for searches, a 21-day retention limit, published audits, and no use for immigration enforcement.\n\nWill you support this and help bring it to an agenda?\n\nThank you,\n[Your name]\n[Your address]";
    } else if (rep.level === "city") {
      var city = rep.cityName || "our city";
      s = "Oversight before " + city + " expands license-plate surveillance";
      b = "Dear " + name + ",\n\nI'm a resident of " + city + " and your constituent. Automated license-plate reader (ALPR) cameras log where every driver goes, yet there has been no public hearing on the rules — who can search the data, how long our movements are stored, or how errors are handled." + (/greenville/i.test(city) ? " Two local sisters were held at gunpoint over a false hit and are now suing." : "") + "\n\nBefore our city adopts or renews any ALPR contract, please hold a public hearing and put oversight in place — a warrant requirement, a short retention limit, published audits, and no immigration or out-of-state bulk sharing.\n\nThank you,\n[Your name]\n[Your address]";
    } else {
      var role = rep.level === "senate" ? "Senator" : "Representative";
      s = "Please champion the Community Data Protection Act (H.4675)";
      b = "Dear " + role + " " + name + ",\n\nI'm a constituent in your district. I support H.4675, the South Carolina Community Data Protection and Responsible Surveillance Act — it keeps license-plate data on in-state government servers, caps retention at 21 days, bars AI vehicle-feature tracking, prohibits use for immigration and routine traffic enforcement, and requires independent audits.\n\nThe bill didn't clear before the session ended. Please re-file or co-sponsor it in the 2027 session and help recruit a partner in the other chamber.\n\nMass license-plate surveillance is the modern general warrant — the exact abuse the Fourth Amendment was written to forbid. Can I count on your leadership?\n\nThank you,\n[Your name]\n[Your address]";
    }
    return { subject: s, body: b };
  }

  /* ---- rendering ---- */
  var LEVELS = {
    senate: { cls: "state", label: "SC Senate" },
    house: { cls: "state", label: "SC House" },
    county: { cls: "county", label: "County Council" },
    city: { cls: "city", label: "City Council" },
  };
  function firstName(n) { return (n || "").split(" ")[0] || "them"; }
  function card(rep, headline) {
    var meta = LEVELS[rep.level];
    var el = document.createElement("article");
    el.className = "rf__card rf__card--" + meta.cls;
    if (rep.vacant || !rep.name) {
      el.innerHTML = '<p class="rf__level">' + headline + '</p><h3>Seat vacant</h3>' +
        '<p class="rf__meta">District ' + rep.district + ' — no sitting member listed.</p>';
      return el;
    }
    var d = draft(rep);
    var contact = [];
    if (rep.email) contact.push('<a href="mailto:' + rep.email + '">' + rep.email + '</a>');
    if (rep.phone) contact.push('<a href="tel:' + rep.phone.replace(/[^0-9+]/g, "") + '">' + rep.phone + '</a>');
    if (rep.website) contact.push('<a href="' + rep.website + '" target="_blank" rel="noopener">official page ↗</a>');
    var mailto = rep.email ? 'mailto:' + rep.email + '?subject=' + esc(d.subject) + '&body=' + esc(d.body) : null;
    el.innerHTML =
      '<p class="rf__level">' + headline + '</p>' +
      '<h3>' + rep.name + '</h3>' +
      '<p class="rf__meta">' + (rep.title ? rep.title : "District " + rep.district) + (rep.party ? ' · ' + rep.party : '') + '</p>' +
      '<p class="rf__contact">' + (contact.join(' &nbsp;·&nbsp; ') || 'Contact via the official page') + '</p>' +
      '<div class="rf__actions">' +
        (mailto ? '<a class="btn btn--primary" href="' + mailto + '">Email ' + firstName(rep.name) + ' ✉</a>' : '') +
        '<button class="btn btn--line rf__copy" type="button">Copy email</button>' +
      '</div>';
    el.querySelector(".rf__copy").addEventListener("click", function (e) {
      var btn = e.currentTarget;
      copyText(d.subject + "\n\n" + d.body, btn);
    });
    return el;
  }
  function copyText(text, btn) {
    var restore = btn.textContent;
    var done = function () { btn.textContent = "Copied ✓"; setTimeout(function () { btn.textContent = restore; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
    else { var t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(t); done(); }
  }

  function render(res) {
    resultsEl.innerHTML = "";
    var any = false;
    if (res.countyId && cameras && cameras["county:" + res.countyId] != null) {
      var n = cameras["county:" + res.countyId];
      var cname = ((reps.counties[res.countyId] && reps.counties[res.countyId].label) || "").replace(/ County Council$/, "") || "your";
      var banner = document.createElement("p");
      banner.className = "rf__local";
      banner.innerHTML = "◎ DeFlock has already mapped <strong>" + n + " ALPR camera" + (n === 1 ? "" : "s") + "</strong> in " + cname + " County — not one put to a public vote. These are the people who can change that:";
      resultsEl.appendChild(banner);
    }
    if (res.county && res.county.rep) { resultsEl.appendChild(card(labelCounty(res.county), (res.county.label || "County Council"))); any = true; }
    if (res.city && res.city.reps && res.city.reps.length) {
      res.city.reps.forEach(function (r) { resultsEl.appendChild(card(r, res.city.label || "City Council")); });
      any = true;
    }
    if (res.state.senate) { resultsEl.appendChild(card(res.state.senate, "SC Senate — District " + res.state.senate.district)); any = true; }
    if (res.state.house) { resultsEl.appendChild(card(res.state.house, "SC House — District " + res.state.house.district)); any = true; }
    if (!res.county && res.state.senate) {
      var note = document.createElement("p");
      note.className = "rf__note";
      note.textContent = "Your county council isn't in our Upstate data set yet — your state legislators are shown above, and you can reach your county directly via its official site.";
      resultsEl.appendChild(note);
    }
    if (!any) setStatus("We couldn't match that location to South Carolina districts. Check the address and try again.", true);
    else { setStatus("Here are the people who can act — email is pre-written; add one sentence of your own and send."); resultsEl.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  }
  function labelCounty(c) { var r = c.rep; r.districtLabel = c.label + " District " + r.district; return r; }

  function run(lat, lng) {
    if (!inBBox(lat, lng, SC_BBOX)) { setStatus("That location looks outside South Carolina. This tool covers SC districts.", true); return; }
    setStatus("Matching your districts…");
    ensureData().then(function () { return matchAll(lat, lng); }).then(render)
      .catch(function (e) { setStatus("Something went wrong loading district data. Please try again.", true); });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = (addr.value || "").trim();
    if (!q) { setStatus("Type your address (or use your location).", true); return; }
    setStatus("Looking up your address…");
    ensureData().then(function () { return geocode(q); })
      .then(function (pt) { run(pt.lat, pt.lng); })
      .catch(function () { setStatus("We couldn't find that address. Try adding your city and ZIP — or use your location.", true); });
  });

  if (geoBtn) geoBtn.addEventListener("click", function () {
    if (!navigator.geolocation) { setStatus("Your browser can't share location — type your address instead.", true); return; }
    setStatus("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      function (pos) { run(pos.coords.latitude, pos.coords.longitude); },
      function () { setStatus("Location access was denied — type your address instead.", true); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  });
})();
