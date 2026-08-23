const GA4_MEASUREMENT_ID_V69 = "G-SL7GG138WV";
const GOOGLE_ADS_TAG_ID_V69 = "AW-18405204387";

window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function farmagreenGtag() {
  window.dataLayer.push(arguments);
};

window.fgTrackGaV69 = function trackGaV69(eventName, parameters = {}) {
  window.gtag("event", eventName, parameters);
};

window.gtag("js", new Date());
window.gtag("config", GA4_MEASUREMENT_ID_V69, {
  send_page_view: true,
  anonymize_ip: true,
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
});
window.gtag("config", GOOGLE_ADS_TAG_ID_V69, {
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
});

const gaScriptV69 = document.createElement("script");
gaScriptV69.async = true;
gaScriptV69.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_MEASUREMENT_ID_V69)}`;
document.head.appendChild(gaScriptV69);
