(function deferFarmagreenMeasurementV69() {
  // Capture the landing before deferred tags or navigation can remove its query.
  var storageKey = "fg-v69-attribution";
  var idleLimitMs = 30 * 60 * 1000;
  var campaignKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_id", "utm_content", "utm_term", "utm_source_platform"];
  var now = Date.now();
  var state = { campaign: {}, fbclid: "", capturedAt: 0, updatedAt: now };

  function validClickId(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(value);
  }

  function validFbc(value) {
    return typeof value === "string" && /^fb\.1\.\d{13}\.[A-Za-z0-9_-]{1,512}$/.test(value);
  }

  function campaignFrom(source) {
    var result = {};
    for (var index = 0; index < campaignKeys.length; index += 1) {
      var key = campaignKeys[index];
      var value = source && source[key];
      if (typeof value === "string" && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f<>]/.test(value)) result[key] = value;
    }
    return result;
  }

  function save() {
    try { window.sessionStorage.setItem(storageKey, JSON.stringify(state)); }
    catch (_) { /* Storage may be disabled; this page still retains its landing. */ }
  }

  try {
    var saved = JSON.parse(window.sessionStorage.getItem(storageKey) || "null");
    if (saved && typeof saved.updatedAt === "number" && now >= saved.updatedAt && now - saved.updatedAt < idleLimitMs) {
      state.campaign = campaignFrom(saved.campaign);
      if (validClickId(saved.fbclid) && Number.isSafeInteger(saved.capturedAt) && saved.capturedAt > 0 && saved.capturedAt <= now) {
        state.fbclid = saved.fbclid;
        state.capturedAt = saved.capturedAt;
      }
    }
  } catch (_) { /* Invalid or unavailable storage must not prevent WhatsApp. */ }

  var landing = new URL(window.location.href);
  var incoming = {};
  for (var index = 0; index < campaignKeys.length; index += 1) incoming[campaignKeys[index]] = landing.searchParams.get(campaignKeys[index]);
  incoming = campaignFrom(incoming);
  var hasIncomingCampaign = Object.keys(incoming).length > 0;
  var googleClick = landing.searchParams.has("gclid") || landing.searchParams.has("gbraid") || landing.searchParams.has("wbraid");
  if (googleClick || (hasIncomingCampaign && JSON.stringify(incoming) !== JSON.stringify(state.campaign))) {
    state.campaign = {};
    state.fbclid = "";
    state.capturedAt = 0;
  }
  if (hasIncomingCampaign && !googleClick) state.campaign = incoming;
  var clickId = landing.searchParams.get("fbclid");
  if (!googleClick && validClickId(clickId) && clickId !== state.fbclid) {
    state.fbclid = clickId;
    state.capturedAt = now;
    var cookieMatch = document.cookie.match(/(?:^|;\s*)_fbc=(fb\.1\.\d{13}\.[A-Za-z0-9_-]{1,512})(?:;|$)/);
    if (cookieMatch && cookieMatch[1].split(".")[3] === clickId) {
      var cookieTime = Number(cookieMatch[1].split(".")[2]);
      if (cookieTime > 0 && cookieTime <= now) state.capturedAt = cookieTime;
    }
  }
  state.updatedAt = now;
  save();

  window.fgAttributionV69 = {
    campaign: function () { return campaignFrom(state.campaign); },
    pageUrl: function () {
      var page = new URL(window.location.href);
      for (var index = 0; index < campaignKeys.length; index += 1) {
        var key = campaignKeys[index];
        if (state.campaign[key] && !page.searchParams.has(key)) page.searchParams.set(key, state.campaign[key]);
      }
      return page.href;
    },
    metaFbc: function (cookie) {
      if (state.fbclid) return "fb.1." + state.capturedAt + "." + state.fbclid;
      return validFbc(cookie) ? cookie : "";
    }
  };

  var marker = document.currentScript || document.querySelector("script[data-fg-measurement-v69]");
  var analyticsSource = marker && marker.getAttribute("data-analytics-src");
  var metaSource = marker && marker.getAttribute("data-meta-src");
  var started = false;
  var interactionEvents = ["touchstart", "mousedown", "keydown"];

  function removeInteractionListeners() {
    for (var index = 0; index < interactionEvents.length; index += 1) {
      window.removeEventListener(interactionEvents[index], start, true);
    }
  }

  function appendScript(source) {
    if (!source) return;
    var script = document.createElement("script");
    script.async = true;
    script.src = source;
    document.head.appendChild(script);
  }

  function start() {
    if (started) return;
    started = true;
    window.__fgMeasurementStartedV69 = true;
    removeInteractionListeners();
    appendScript(analyticsSource);
    appendScript(metaSource);
  }

  function startWhenIdle() {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(start, { timeout: 3000 });
    } else {
      window.setTimeout(start, 1200);
    }
  }

  for (var index = 0; index < interactionEvents.length; index += 1) {
    window.addEventListener(interactionEvents[index], start, true);
  }
  if (document.readyState === "complete") startWhenIdle();
  else window.addEventListener("load", startWhenIdle, false);
})();
