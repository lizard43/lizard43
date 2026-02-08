/* global L */
(() => {
  const STORAGE_KEY = "adster.route.mapPayload";
  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  function normalizeUrl(u) {
    const s = String(u || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith("//")) return "https:" + s;
    if (/^[\w.-]+\.[a-z]{2,}([/?#]|$)/i.test(s)) return "https://" + s;
    return s;
  }

  function milesToMeters(mi) {
    const n = Number(mi);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n * 1609.344;
  }

  function metersPerDegLat() { return 111320; }
  function metersPerDegLon(latDeg) { return 111320 * Math.cos((latDeg * Math.PI) / 180); }
  function rad(deg) { return (deg * Math.PI) / 180; }
  function deg(radVal) { return (radVal * 180) / Math.PI; }

  function bearingDeg(a, b) {
    const lat1 = rad(a.lat), lat2 = rad(b.lat);
    const dLon = rad(b.lon - a.lon);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const brng = deg(Math.atan2(y, x));
    return (brng + 360) % 360;
  }

  function buildSemiCirclePolygon(center, radiusMeters, midBearingDeg, steps = 90) {
    if (!radiusMeters || radiusMeters <= 0) return null;
    const start = midBearingDeg - 90;
    const end = midBearingDeg + 90;

    const pts = [];
    pts.push([center.lat, center.lon]);

    const my = metersPerDegLat();
    const mx = metersPerDegLon(center.lat);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const b = start + (end - start) * t;
      const ang = rad(b);

      const dLat = (Math.cos(ang) * radiusMeters) / my;
      const dLon = (Math.sin(ang) * radiusMeters) / mx;
      pts.push([center.lat + dLat, center.lon + dLon]);
    }
    return pts;
  }

  function buildCorridorPolygon(home, dest, halfWidthMiles) {
    const wMeters = milesToMeters(halfWidthMiles);
    if (!wMeters) return null;

    const lat0 = (home.lat + dest.lat) / 2;
    const mx = metersPerDegLon(lat0);
    const my = metersPerDegLat();

    const dx = (dest.lon - home.lon) * mx;
    const dy = (dest.lat - home.lat) * my;

    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 1) return null;

    const px = -dy / len;
    const py =  dx / len;

    const dLon = (px * wMeters) / mx;
    const dLat = (py * wMeters) / my;

    const h1 = [home.lat + dLat, home.lon + dLon];
    const h2 = [home.lat - dLat, home.lon - dLon];
    const d2 = [dest.lat - dLat, dest.lon - dLon];
    const d1 = [dest.lat + dLat, dest.lon + dLon];

    return [h1, d1, d2, h2];
  }

  const map = L.map("map", { zoomControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const layer = L.layerGroup().addTo(map);

  const homeIcon = L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -24],
    html: `
      <div style="width:28px;height:28px;display:flex;align-items:flex-end;justify-content:center;">
        <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
          <path d="M8 30 L32 10 L56 30" fill="none" stroke="#2b73ff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M16 28 V54 H48 V28" fill="rgba(43,115,255,0.18)" stroke="#2b73ff" stroke-width="6" stroke-linejoin="round"/>
          <path d="M28 54 V38 H36 V54" fill="rgba(43,115,255,0.08)" stroke="#2b73ff" stroke-width="6" stroke-linejoin="round"/>
        </svg>
      </div>
    `
  });

  function loadPayload() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn("Failed to parse payload:", e);
      return null;
    }
  }

  function pickImageUrl(ad) {
    const direct = ad.imageUrl || ad.image || ad.thumb || ad.thumbnail || ad.photo || ad.img;
    if (direct) return String(direct);

    const arr = ad.images || ad.imageUrls || ad.photos || ad.photoUrls;
    if (Array.isArray(arr) && arr.length) return String(arr[0]);

    return "";
  }

  function pickAdUrl(ad) {
    const u = ad.url || ad.adUrl || ad.href || ad.link || ad.AdUrl || ad.permalink || ad.marketplaceUrl;
    return normalizeUrl(u);
  }

  function makePopupHtml(ad) {
    const titleText = escapeHtml(ad.title || "");
    const priceText = escapeHtml(ad.price || "");
    const locationText = escapeHtml(ad.location || ad.city || ad.place || "");

    const url = pickAdUrl(ad);
    const imgUrl = normalizeUrl(pickImageUrl(ad));

    const distBits = [];
    if (ad.offRouteMiles != null) distBits.push(`off-route ${Number(ad.offRouteMiles).toFixed(1)} mi`);
    if (ad.fromHomeMiles != null) distBits.push(`from home ${Number(ad.fromHomeMiles).toFixed(1)} mi`);

    const thumbHtml = imgUrl
      ? `<div class="route-thumb">
           <img src="${escapeHtml(imgUrl)}"
                alt=""
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
                crossorigin="anonymous"
                onerror="this.closest('.route-thumb').textContent='No image';" />
         </div>`
      : `<div class="route-thumb">No image</div>`;

    const titleHtml = url
      ? `<a class="route-title" href="${escapeHtml(url)}" data-adster-open="ad">${titleText}</a>`
      : `<div class="route-title">${titleText}</div>`;

    return [
      `<div class="route-card">`,
        thumbHtml,
        `<div class="route-body">`,
          titleHtml,
          priceText ? `<div class="route-price">${priceText}</div>` : ``,
          locationText ? `<div class="route-loc">${locationText}</div>` : ``,
          distBits.length ? `<div class="route-dist">${escapeHtml(distBits.join(" · "))}</div>` : ``,
        `</div>`,
      `</div>`
    ].join("");
  }

  function draw(payload) {
    layer.clearLayers();

    if (!payload || !payload.home || !payload.destination) {
      $("meta").textContent = "No payload found in localStorage.";
      map.setView([39.5, -98.35], 4);
      return;
    }

    const home = payload.home;
    const dest = payload.destination;
    const corridorMiles = Number(payload.corridorMiles || 0);
    const destRadiusMiles = Number(payload.destRadiusMiles ?? corridorMiles);

    const bounds = [];

    L.marker([home.lat, home.lon], { icon: homeIcon })
      .addTo(layer)
      .bindPopup("<b>Home</b><br>" + escapeHtml(home.label || ""));
    bounds.push([home.lat, home.lon]);

    L.marker([dest.lat, dest.lon])
      .addTo(layer)
      .bindPopup("<b>Destination</b><br>" + escapeHtml(dest.label || ""));
    bounds.push([dest.lat, dest.lon]);

    L.polyline([[home.lat, home.lon], [dest.lat, dest.lon]], { weight: 3 }).addTo(layer);

    const band = buildCorridorPolygon(home, dest, corridorMiles);
    if (band) {
      L.polygon(band, { weight: 2, color: "#2b73ff", opacity: 0.45, fillOpacity: 0.08 }).addTo(layer);
      for (const p of band) bounds.push(p);
    }

    // Home semi-circle BEHIND (more visible than before)
    const homeSemiMeters = milesToMeters(corridorMiles);
    if (homeSemiMeters > 0) {
      const brng = bearingDeg(home, dest);
      const behind = (brng + 180) % 360;
      const pts = buildSemiCirclePolygon(home, homeSemiMeters, behind, 90);
      if (pts) {
        L.polygon(pts, { weight: 2, color: "#2b73ff", opacity: 0.35, fillOpacity: 0.06 }).addTo(layer);
        for (const p of pts) bounds.push(p);
      }
    }

    // Destination semi-circle FORWARD
    const radiusMeters = milesToMeters(destRadiusMiles);
    if (radiusMeters > 0) {
      const brng = bearingDeg(dest, home);
      const forward = (brng + 180) % 360;
      const pts = buildSemiCirclePolygon(dest, radiusMeters, forward, 90);
      if (pts) {
        L.polygon(pts, { weight: 2, color: "#2b73ff", opacity: 0.45, fillOpacity: 0.05 }).addTo(layer);
        for (const p of pts) bounds.push(p);
      }
    }

    const ads = Array.isArray(payload.ads) ? payload.ads : [];
    for (const ad of ads) {
      if (!ad || !Number.isFinite(ad.lat) || !Number.isFinite(ad.lon)) continue;
      bounds.push([ad.lat, ad.lon]);

      const popupHtml = makePopupHtml(ad);

      const marker = L.circleMarker([ad.lat, ad.lon], {
        radius: 6,
        weight: 2,
        color: "#2b73ff",
        opacity: 0.9,
        fillColor: "#2b73ff",
        fillOpacity: 0.35
      }).addTo(layer);

      marker.bindPopup(popupHtml, { maxWidth: 420, className: "adster-popup" });

      marker.on("popupopen", (ev) => {
        const el = ev.popup && ev.popup.getElement ? ev.popup.getElement() : null;
        if (!el) return;
        L.DomEvent.disableClickPropagation(el);
        L.DomEvent.disableScrollPropagation(el);

        // Reuse a single "ad tab" when opening ad links from the map.
        // Using a named window causes subsequent opens to reuse the same tab.
        const links = el.querySelectorAll('a.route-title[data-adster-open="ad"]');
        for (const a of links) {
          if (a.__adsterBound) continue;
          a.__adsterBound = true;
          a.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const href = a.getAttribute("href");
            if (!href) return;
            window.open(href, "adster_ad");
          }, { passive: false });
        }
      });
    }

    $("meta").textContent =
      `Loaded ${ads.length} ads • corridor ${corridorMiles || 0} mi • dest radius ${destRadiusMiles || 0} mi • ${payload.generatedAtISO || ""}`;

    if (bounds.length >= 2) map.fitBounds(bounds, { padding: [30, 30] });
    else map.setView([dest.lat, dest.lon], 10);
  }

  $("btnReload").addEventListener("click", () => draw(loadPayload()));
  draw(loadPayload());
})();