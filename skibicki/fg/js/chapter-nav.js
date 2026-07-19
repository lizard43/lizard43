(function () {
  function makeLink(className, href, aria, children) {
    const a = document.createElement("a");
    a.className = className;
    a.href = href;
    a.setAttribute("aria-label", aria);

    for (const child of children) {
      a.appendChild(child);
    }

    return a;
  }

  function makeSpan(className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }

  function makePlaceholder(className) {
    const span = document.createElement("span");
    span.className = className + " nav-placeholder";
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  function renderChapterNav(navEl, cfg) {
    navEl.textContent = "";

    if (cfg.back && cfg.back.href) {
      navEl.appendChild(makeLink("prev", cfg.back.href, cfg.back.aria || cfg.back.title || "Previous chapter", [
        makeSpan("nav-arrow", "⟵"),
        makeSpan("nav-title", cfg.back.title || "Back")
      ]));
    } else {
      navEl.appendChild(makePlaceholder("prev"));
    }

    const home = cfg.home || { href: "index.html", icon: "⌂", aria: "Home" };

    navEl.appendChild(makeLink("index", home.href, home.aria || "Home", [
      makeSpan("home-icon", home.icon || "⌂")
    ]));

    if (cfg.fwd && cfg.fwd.href) {
      navEl.appendChild(makeLink("next", cfg.fwd.href, cfg.fwd.aria || cfg.fwd.title || "Next chapter", [
        makeSpan("nav-title", cfg.fwd.title || "Next"),
        makeSpan("nav-arrow", "⟶")
      ]));
    } else {
      navEl.appendChild(makePlaceholder("next"));
    }
  }

  function initChapterNav() {
    const cfg = window.CHAPTER_NAV || {};
    document.querySelectorAll("[data-chapter-nav]").forEach((navEl) => {
      renderChapterNav(navEl, cfg);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initChapterNav);
  } else {
    initChapterNav();
  }
})();