(() => {

  function getJavaScriptLocation() {
    const scripts = Array.from(document.scripts || []);
    const script = document.currentScript || scripts.reverse().find(function (candidate) {
      const src = candidate && candidate.src ? candidate.src : "";
      return /(?:^|\/)loader\.js(?:[?#].*)?$/.test(src);
    });

    if (script && script.src) {
      return new URL(".", script.src).href;
    }

    return "";
  }

  function getLoaderScript() {
    const scripts = Array.from(document.scripts || []);
    return document.currentScript || scripts.reverse().find(function (candidate) {
      const src = candidate && candidate.src ? candidate.src : "";
      return /(?:^|\/)loader\.js(?:[?#].*)?$/.test(src);
    });
  }

  function revealBody() {
    if (document.body) {
      document.body.style.visibility = "visible";
    }
  }

  function loadScript(src) {
    const js = document.createElement("script");
    js.src = src;
    js.defer = true;
    js.async = false;
    document.head.appendChild(js);
    return js;
  }

  const JSLOC = getJavaScriptLocation();
  const v = Date.now();

  const loaderScript = getLoaderScript();
  const params = loaderScript && loaderScript.src
    ? new URL(loaderScript.src).searchParams
    : new URLSearchParams();

  const nomenu = params.has("nomenu");

  // CSS
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = `${JSLOC}../css/field-guide.css?v=${v}`;

  css.onload = () => {
    // show UI only after CSS is applied (prevents FOUC)
    revealBody();
  };

  css.onerror = () => {
    // fail-open: don't keep UI hidden if CSS fails
    revealBody();
  };

  document.head.appendChild(css);

  // Main JS
  if (!nomenu) {
    loadScript(`${JSLOC}../js/menu.js?v=${v}`);
  } else {
    loadScript(`${JSLOC}../js/menu.js?nomenu&v=${v}`);
  }

  // Chapter navigation JS
  loadScript(`${JSLOC}../js/chapter-nav.js?v=${v}`);

  // safety: reveal anyway after a short delay (covers weird onload edge cases)
  window.setTimeout(() => {
    if (document.body && document.body.style.visibility === "hidden") {
      revealBody();
    }
  }, 1500);
})();
