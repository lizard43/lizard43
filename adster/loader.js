(() => {
  const v = Date.now();

  // CSS
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = `ads.css?v=${v}`;

  css.onload = () => {
    // show UI only after CSS is applied (prevents FOUC)
    if (document.body) document.body.style.visibility = "visible";
  };

  css.onerror = () => {
    // fail-open: don't keep UI hidden if CSS fails
    if (document.body) document.body.style.visibility = "visible";
  };

  document.head.appendChild(css);

  // Main JS
  const js = document.createElement("script");
  js.src = `ads.js?v=${v}`;
  js.defer = true;
  document.head.appendChild(js);

  // safety: reveal anyway after a short delay (covers weird onload edge cases)
  window.setTimeout(() => {
    if (document.body && document.body.style.visibility === "hidden") {
      document.body.style.visibility = "visible";
    }
  }, 1500);
})();
