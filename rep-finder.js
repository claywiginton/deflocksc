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

  /* ---- personalizer (the light "make it yours" fields, injected with results) ---- */
  function fieldVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }
  function pName() { return fieldVal("rfName") || "[Your name]"; }
  function pHood() { return fieldVal("rfHood") || "my neighborhood"; }
  function pWhy() { return fieldVal("rfWhy"); }
  function personalizerEl() {
    var me = document.createElement("div");
    me.className = "rf__me";
    me.innerHTML =
      '<p class="rf__me-h">Make these messages yours — 30 seconds (this is what makes them count)</p>' +
      '<div class="rf__me-grid">' +
        '<input id="rfName" class="rf__input" type="text" placeholder="Your name" autocomplete="name" />' +
        '<input id="rfHood" class="rf__input" type="text" placeholder="Your neighborhood or town" />' +
        '<input id="rfWhy" class="rf__input rf__why" type="text" placeholder="One line — why does this matter to you? (e.g. I pass a camera on Woodruff Rd every day)" />' +
      '</div>';
    return me;
  }
  function esc(s) { return encodeURIComponent(s); }

  /* ---- the specific ask, per level ---- */
  function askFor(rep) {
    if (rep.level === "county") return "adopt a local ordinance requiring a public vote, a warrant for searches, a 21-day data limit, and published audits before any license-plate cameras operate";
    if (rep.level === "city") return "hold a public hearing and put real oversight in place before the city adopts or renews any Flock camera contract";
    return "re-file and support H.4675, the South Carolina Community Data Protection Act, in the 2027 session";
  }
  function greet(rep) {
    if (rep.level === "senate") return "Senator " + rep.name;
    if (rep.level === "house") return "Representative " + rep.name;
    return rep.name;
  }
  function callTitle(rep) {
    if (rep.level === "senate") return "Senator " + rep.name;
    if (rep.level === "house") return "Representative " + rep.name;
    return "Councilmember " + rep.name;
  }

  /* ---- personalized email (built fresh so it reflects the current fields) ---- */
  function draft(rep) {
    var subj = rep.level === "county" ? "Please put ALPR surveillance oversight on the agenda"
      : rep.level === "city" ? "A public hearing before " + (rep.cityName || "our city") + " expands license-plate surveillance"
      : "Please champion the Community Data Protection Act (H.4675)";
    var why = pWhy();
    var opener = "My name is " + pName() + " and I live in " + pHood() + "." + (why ? " " + why : "");
    var close = (rep.level === "senate" || rep.level === "house")
      ? "Mass license-plate surveillance is the modern general warrant — the exact search the Fourth Amendment was written to forbid. Can I count on your leadership?"
      : "This is exactly the un-voted, unaccountable surveillance a free community should refuse. Can I count on your support?";
    var body = "Dear " + greet(rep) + ",\n\n" + opener + "\n\nI'm asking you to " + askFor(rep) + ".\n\n" + close + "\n\nThank you,\n" + pName() + "\n" + pHood();
    return { subject: subj, body: body };
  }

  /* ---- call script (built fresh from the same fields) ---- */
  function script(rep) {
    var why = pWhy();
    return "Hi, my name is " + pName() + " and I'm a constituent in " + pHood() + ".\n\n" +
      "I'm calling to ask " + callTitle(rep) + " to " + askFor(rep) + ".\n\n" +
      (why ? why + "\n\n" : "") +
      "Can I count on their support? Thank you.";
  }
  function htmlesc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }

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
    var tel = rep.phone ? rep.phone.replace(/[^0-9+]/g, "") : null;
    var contact = [];
    if (rep.phone) contact.push('<a href="tel:' + tel + '">' + rep.phone + '</a>');
    if (rep.email) contact.push('<a href="mailto:' + rep.email + '">' + rep.email + '</a>');
    if (rep.website) contact.push('<a href="' + rep.website + '" target="_blank" rel="noopener">official page ↗</a>');
    var actions = '<div class="rf__actions">';
    if (tel) actions += '<a class="btn btn--primary" href="tel:' + tel + '">Call ' + firstName(rep.name) + '</a><button class="btn btn--line rf__scriptbtn" type="button">Call script</button>';
    if (rep.email) actions += '<button class="btn ' + (tel ? 'btn--line' : 'btn--primary') + ' rf__emailbtn" type="button">Write email</button>';
    actions += '</div>';
    el.innerHTML =
      '<p class="rf__level">' + headline + '</p>' +
      '<h3>' + rep.name + '</h3>' +
      '<p class="rf__meta">' + (rep.title ? rep.title : "District " + rep.district) + (rep.party ? ' · ' + rep.party : '') + '</p>' +
      '<p class="rf__contact">' + (contact.join(' &nbsp;·&nbsp; ') || 'Contact via the official page') + '</p>' +
      actions +
      '<div class="rf__script"></div>';
    var panel = el.querySelector(".rf__script");
    var sb = el.querySelector(".rf__scriptbtn");
    if (sb) sb.addEventListener("click", function () {
      var t = script(rep);
      panel.innerHTML = '<pre>' + htmlesc(t) + '</pre><button class="tmpl__copy" type="button">Copy script</button>';
      panel.classList.add("show");
      panel.querySelector(".tmpl__copy").addEventListener("click", function (e) { copyText(t, e.currentTarget); });
    });
    var eb = el.querySelector(".rf__emailbtn");
    if (eb) eb.addEventListener("click", function () {
      var d = draft(rep);
      var mailto = 'mailto:' + rep.email + '?subject=' + esc(d.subject) + '&body=' + esc(d.body);
      panel.innerHTML = '<pre>' + htmlesc(d.subject + "\n\n" + d.body) + '</pre>' +
        '<a class="btn btn--primary" href="' + mailto + '" style="font-size:.72rem;padding:.5rem .9rem">Open in email ✉</a> <button class="tmpl__copy" type="button">Copy</button>';
      panel.classList.add("show");
      panel.querySelector(".tmpl__copy").addEventListener("click", function (e) { copyText(d.subject + "\n\n" + d.body, e.currentTarget); });
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
    resultsEl.appendChild(personalizerEl());

    var prio = document.createElement("p");
    prio.className = "rf__priority";
    prio.innerHTML = "What actually works, in order: <strong>1) call</strong> &nbsp; <strong>2) show up</strong> at a meeting &nbsp; <strong>3) a message in your own words</strong>. A form email everyone sends gets tallied as one voice — so fill in your name and reason above, and each message becomes yours.";
    resultsEl.appendChild(prio);

    if (res.county && res.county.rep) { resultsEl.appendChild(card(labelCounty(res.county), (res.county.label || "County Council"))); any = true; }
    if (res.city && res.city.reps && res.city.reps.length) {
      res.city.reps.forEach(function (r) { resultsEl.appendChild(card(r, res.city.label || "City Council")); });
      any = true;
    }
    if (res.county && res.county.rep) resultsEl.appendChild(showUp(res.countyId));
    if (res.state.senate) { resultsEl.appendChild(card(res.state.senate, "SC Senate — District " + res.state.senate.district)); any = true; }
    if (res.state.house) { resultsEl.appendChild(card(res.state.house, "SC House — District " + res.state.house.district)); any = true; }
    if (!res.county && res.state.senate) {
      var note = document.createElement("p");
      note.className = "rf__note";
      note.textContent = "Your county council isn't in our data set — your state legislators are shown above, and you can reach your county directly via its official site.";
      resultsEl.appendChild(note);
    }
    if (!any) setStatus("We couldn't match that location to South Carolina districts. Check the address and try again.", true);
    else { setStatus("Start with a call or a council meeting — email is the backup. Fill in your name and one reason above and every message becomes unmistakably yours."); resultsEl.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  }
  function labelCounty(c) { var r = c.rep; r.districtLabel = c.label + " District " + r.district; return r; }
  function showUp(countyId) {
    var label = (reps.counties[countyId] && reps.counties[countyId].label) || "your county council";
    var cname = label.replace(/ Council$/, "");
    var meeting = countyId === "greenville"
      ? 'Greenville County Council meets the <strong>1st &amp; 3rd Tuesday</strong>, 6&nbsp;p.m., at County Square, 301 University Ridge. Register to speak on the <a href="https://www.greenvillecounty.org/apps/citizencomments/" target="_blank" rel="noopener" style="color:var(--brass)">Citizen Comments form ↗</a> — it opens 4:45&nbsp;p.m. the Monday before (or sign up in person 4:15–4:45&nbsp;p.m. that day). Each speaker gets 3 minutes.'
      : cname + " holds a public-comment period — find the next date and the sign-up process on the county's official website.";
    var el = document.createElement("div");
    el.className = "rf__showup";
    el.innerHTML =
      '<p class="k">The single most powerful move</p>' +
      '<h4>Show up — three minutes at the podium</h4>' +
      '<p>A handful of residents at public comment can move a local vote. ' + meeting + '</p>' +
      '<ol>' +
        "<li><strong>Say you're a constituent</strong> — your name and where you live.</li>" +
        '<li><strong>Give one real reason</strong> it matters to you (the line you wrote above works).</li>' +
        '<li><strong>Make the specific ask</strong> — a public vote, a warrant, a 21-day data limit, and audits before any camera runs.</li>' +
        '<li><strong>Keep it under three minutes, stay civil, and bring a neighbor.</strong></li>' +
      '</ol>';
    return el;
  }

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
