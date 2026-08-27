(function deferFarmagreenMeasurementV69() {
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
