// Filename: loader.js
// Version: 20260922-012930

(() => {
  "use strict";

  const refreshVersion = Date.now();
  const revealPage = () => {
    document.documentElement.classList.remove("assets-loading");
  };

  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = `archive.css?v=${refreshVersion}`;
  css.addEventListener("load", revealPage, { once: true });
  css.addEventListener("error", revealPage, { once: true });
  document.head.appendChild(css);

  const application = document.createElement("script");
  application.src = `archive.js?v=${refreshVersion}`;
  application.defer = true;
  document.head.appendChild(application);

  window.setTimeout(revealPage, 1500);
})();
