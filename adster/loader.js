(() => {
  const v = Date.now();

  // CSS
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = `ads.css?v=${v}`;
  document.head.appendChild(css);

  // Main JS
  const js = document.createElement("script");
  js.src = `ads.js?v=${v}`;
  js.defer = true;
  document.head.appendChild(js);
})();
