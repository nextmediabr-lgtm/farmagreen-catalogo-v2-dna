const META_PIXEL_ID_V69 = "1198250568817946";

(function bootstrapMetaPixel(f, b, e, v, n, t, s) {
  if (f.fbq) return;
  n = f.fbq = function metaPixelQueue() {
    n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
  };
  if (!f._fbq) f._fbq = n;
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
window.fbq("track", "PageView");

for (const [eventName, parameters] of window.__FG_META_QUEUE || []) {
  window.fbq("track", eventName, parameters);
}
window.__FG_META_QUEUE = [];
