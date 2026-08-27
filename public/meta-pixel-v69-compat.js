/* Generado por scripts/build-v69-client.mjs. No editar. */
const META_PIXEL_ID_V69 = "1198250568817946";
const META_CAPI_ENDPOINT_V69 = "/api/meta-events-v6-9";
(function bootstrapMetaPixel(f, b, e, v, n, t, s) {
    if (f.fbq)
        return;
    n = f.fbq = function metaPixelQueue() {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq)
        f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    t = b.createElement(e);
    t.async = true;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
})(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
window.fbq("init", META_PIXEL_ID_V69);
function metaEventIdV69() {
    var _a;
    if (typeof ((_a = window.crypto) === null || _a === void 0 ? void 0 : _a.randomUUID) === "function")
        return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}
function metaCookieV69(name) {
    var _a;
    const prefix = `${name}=`;
    return ((_a = document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(prefix))) === null || _a === void 0 ? void 0 : _a.slice(prefix.length)) || "";
}
function sendMetaServerEventV69(eventName, parameters, eventId) {
    const body = {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        event_source_url: location.href,
        fbp: metaCookieV69("_fbp"),
        fbc: metaCookieV69("_fbc"),
        custom_data: parameters,
    };
    fetch(META_CAPI_ENDPOINT_V69, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify(body),
    }).catch(() => { });
}
window.fgTrackMetaV69 = function trackMetaV69(eventName, parameters = {}, options = {}) {
    const eventId = metaEventIdV69();
    window.fbq(options.custom ? "trackCustom" : "track", eventName, parameters, { eventID: eventId });
    sendMetaServerEventV69(eventName, parameters, eventId);
    return eventId;
};
window.fgTrackMetaV69("PageView");
for (const [eventName, parameters, options] of window.__FG_META_QUEUE || []) {
    window.fgTrackMetaV69(eventName, parameters, options);
}
window.__FG_META_QUEUE = [];
