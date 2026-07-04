/*
  Astrocade Arcade Field Guide shared hamburger / TOC menu.

  Use on every page with:
    <link rel="stylesheet" href="field-guide.css" />
    <script src="js/menu.js" defer></script>

  The script injects the hamburger controls directly after <body> and inserts
  the off-canvas <nav class="toc"> as the first child of <main>.

  Edit FIELD_GUIDE_MENU below to maintain the TOC in one place.

  Sub-items:
    - Flat style:   { label: "Sub page", href: "sub.html", sub: true }
    - Level style:  { label: "Deep page", href: "deep.html", level: 2 }
    - Nested style: { label: "Parent", href: "parent.html", items: [ ... ] }
*/


(function () {
  "use strict";

  const script = document.currentScript;
  const params = new URL(script.src).searchParams;
  const nomenu = params.has("nomenu");

  function getJavaScriptLocation() {
    const scripts = Array.from(document.scripts || []);
    const script = document.currentScript || scripts.reverse().find(function (candidate) {
      const src = candidate && candidate.src ? candidate.src : "";
      return /(?:^|\/)menu\.js(?:[?#].*)?$/.test(src);
    });

    if (script && script.src) {
      return new URL(".", script.src).href;
    }

    return "";
  }

  const JSLOC = getJavaScriptLocation();

  const FIELD_GUIDE_MENU = {
    title: "Field Guide TOC",
    buttonLabel: "Open or close chapter map",
    buttonText: "Chapter Map",
    closeLabel: "Close chapter map",
    items: [
      { label: "Intro", href: JSLOC + "../index.html" },
      { label: "Build Environment", href: JSLOC + "../sw/build-environment.html" },
      { label: "Build Environment", href: JSLOC + "../sw/build-environment.html" },
      {
        label: "Machine Model", href: JSLOC + "../hw/machine-model.html",
        items: [
          { label: "Memory Maps", href: JSLOC + "../hw/memory-map.html" },
          { label: "I/O Maps", href: JSLOC + "../hw/memory-map.html" },
          { label: "90708 Game Board", href: JSLOC + "../hw/pcbs/90708.html" },
          { label: "91354 CPU Board", href: JSLOC + "../hw/pcbs/91354.html" },
          { label: "91355 Pattern Board", href: JSLOC + "../hw/pcbs/91355.html" },
          { label: "91363 RGB Interface Board", href: JSLOC + "../hw/pcbs/91363.html" }
        ]
      },
      { label: "I/O Map", href: JSLOC + "../hw/io-map.html" },
      { label: "Video System", href: JSLOC + "../hw/video-system.html" },
      { label: "Inputs and DIP Switches", href: JSLOC + "../hw/inputs-dip-switches.html" },
      { label: "Sound", href: JSLOC + "../hw/sound.html" },
      { label: "Pattern Board", href: JSLOC + "../hw/pattern-board.html" },
      { label: "References", href: JSLOC + "../refs/references.html" },
    ]
  };

  const MAX_MENU_LEVEL = 4;
  let keydownHandlerInstalled = false;
  let hashChangeHandlerInstalled = false;
  let currentManagedNav = null;

  function shouldBuildFieldGuideMenu() {
    return Boolean(document.body && document.body.classList && document.body.classList.contains("guide-chapter"));
  }

  function makeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined && text !== null) {
      element.textContent = text;
    }
    return element;
  }

  function clampLevel(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 0;
    }
    return Math.max(0, Math.min(MAX_MENU_LEVEL, Math.floor(numeric)));
  }

  function menuItemLevel(item, inheritedLevel) {
    if (item && item.level !== undefined) {
      return clampLevel(item.level);
    }

    if (item && item.sub) {
      return Math.max(1, clampLevel(inheritedLevel));
    }

    return clampLevel(inheritedLevel);
  }

  function flattenMenuItems(items, inheritedLevel, output) {
    (items || []).forEach(function (item) {
      if (!item) {
        return;
      }

      if (item.separator) {
        output.push({ separator: true, level: clampLevel(inheritedLevel) });
        return;
      }

      const level = menuItemLevel(item, inheritedLevel);
      output.push(Object.assign({}, item, { level: level }));

      const children = item.items || item.children || item.subitems;
      if (children && children.length) {
        flattenMenuItems(children, level + 1, output);
      }
    });

    return output;
  }

  function normalizedLocation(href) {
    try {
      const url = new URL(href, window.location.href);
      const pathname = url.pathname.replace(/\/+$/, "");
      const page = pathname.split("/").pop() || "index.html";
      return {
        page: page,
        hash: url.hash || ""
      };
    } catch (error) {
      const raw = String(href || "");
      const parts = raw.split("#");
      const cleaned = parts[0].split(/[?]/)[0].replace(/\/+$/, "");
      return {
        page: cleaned.split("/").pop() || "index.html",
        hash: parts[1] ? "#" + parts[1] : ""
      };
    }
  }

  function isCurrentHref(href) {
    const current = normalizedLocation(window.location.href);
    const target = normalizedLocation(href);

    if (current.page !== target.page) {
      return false;
    }

    // Anchor links should only highlight when that exact hash is active.
    if (target.hash) {
      return current.hash === target.hash;
    }

    // Plain page links highlight only at the top of that page.
    return current.hash === "";
  }

  function updateCurrentLinks(nav) {
    if (!nav) {
      return;
    }

    nav.querySelectorAll("a.toc-link").forEach(function (link) {
      if (isCurrentHref(link.getAttribute("href"))) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function removeExistingMenuShell() {
    document.querySelectorAll("#toc-toggle, .toc-button, .toc-backdrop").forEach(function (element) {
      element.remove();
    });

    // Lets this script be dropped into old pages without manually removing
    // the pasted static TOC first.
    document.querySelectorAll("main > nav.toc").forEach(function (element) {
      element.remove();
    });
  }

  function buildToggleShell(menu) {
    const toggle = makeElement("input", "toc-toggle");
    toggle.id = "toc-toggle";
    toggle.type = "checkbox";
    toggle.setAttribute("aria-hidden", "true");

    const button = makeElement("label", "toc-button");
    button.setAttribute("for", toggle.id);
    button.setAttribute("aria-label", menu.buttonLabel || "Open or close chapter map");

    const icon = makeElement("span", "toc-button-icon", "☰");
    const text = makeElement("span", "toc-button-text", menu.buttonText || "Chapter Map");
    button.append(icon, text);

    const backdrop = makeElement("label", "toc-backdrop");
    backdrop.setAttribute("for", toggle.id);
    backdrop.setAttribute("aria-label", "Close chapter map");

    const shell = document.createDocumentFragment();
    shell.append(toggle, button, backdrop);
    document.body.insertBefore(shell, document.body.firstChild);

    return toggle;
  }

  function buildTocHeader(menu) {
    const header = makeElement("div", "toc-panel-head");
    const heading = makeElement("h2", "", menu.title || "Field Guide TOC");

    const close = makeElement("label", "toc-close");
    close.setAttribute("for", "toc-toggle");
    close.setAttribute("aria-label", menu.closeLabel || "Close chapter map");
    close.setAttribute("title", menu.closeLabel || "Close chapter map");

    close.append(
      makeElement("span", "toc-close-icon", "×"),
      makeElement("span", "toc-close-text", menu.closeLabel || "Close chapter map")
    );

    header.append(heading, close);
    return header;
  }

  function buildTocLink(item) {
    const level = clampLevel(item.level);
    const link = makeElement("a", "toc-link", item.label || item.href || "Untitled");

    link.href = item.href || "#";
    link.dataset.tocLevel = String(level);
    link.style.setProperty("--toc-level", String(level));

    if (level > 0 || item.sub) {
      link.classList.add("toc-link-sub");
      link.classList.add("toc-link-level-" + String(level));
    }

    if (item.className) {
      String(item.className).split(/\s+/).filter(Boolean).forEach(function (name) {
        link.classList.add(name);
      });
    }

    if (item.title) {
      link.title = item.title;
    }

    if (item.target) {
      link.target = item.target;
    }

    if (item.rel) {
      link.rel = item.rel;
    }

    if (item.note) {
      link.append(makeElement("small", "", item.note));
    }

    return link;
  }

  function buildToc(menu) {
    const main = document.querySelector("main");
    if (!main) {
      return null;
    }

    const nav = makeElement("nav", "toc");
    nav.setAttribute("aria-label", "Table of contents");
    nav.dataset.menuManaged = "true";

    nav.append(buildTocHeader(menu));

    flattenMenuItems(menu.items || [], 0, []).forEach(function (item) {
      if (item.separator) {
        const rule = makeElement("div", "toc-separator");
        rule.style.setProperty("--toc-level", String(clampLevel(item.level)));
        nav.append(rule);
        return;
      }

      nav.append(buildTocLink(item));
    });

    const content = main.querySelector(":scope > .content");
    main.insertBefore(nav, content || main.firstChild);
    updateCurrentLinks(nav);
    currentManagedNav = nav;
    return nav;
  }

  function closeMenu() {
    const toggle = document.getElementById("toc-toggle");
    if (toggle) {
      toggle.checked = false;
    }
  }

  function installGlobalHandlers() {
    if (!keydownHandlerInstalled) {
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          closeMenu();
        }
      });
      keydownHandlerInstalled = true;
    }

    if (!hashChangeHandlerInstalled) {
      window.addEventListener("hashchange", function () {
        updateCurrentLinks(currentManagedNav);
      });
      hashChangeHandlerInstalled = true;
    }
  }

  function bindMenuBehavior(toggle, nav) {
    installGlobalHandlers();

    if (!toggle || !nav) {
      return;
    }

    nav.addEventListener("click", function (event) {
      const link = event.target.closest("a");
      if (!link) {
        return;
      }

      // Let the browser update the URL/hash first, then update the highlight.
      window.setTimeout(function () {
        updateCurrentLinks(nav);
      }, 0);

      closeMenu();
    });
  }

  function buildFieldGuideMenu(menu) {
    if (!shouldBuildFieldGuideMenu()) {
      return;
    }

    const previousToggle = document.getElementById("toc-toggle");
    const wasOpen = Boolean(previousToggle && previousToggle.checked);

    removeExistingMenuShell();

    const toggle = buildToggleShell(menu);
    const nav = buildToc(menu);
    toggle.checked = wasOpen;

    bindMenuBehavior(toggle, nav);
  }

  function init() {
    if (!shouldBuildFieldGuideMenu()) {
      return;
    }

    if (nomenu) FIELD_GUIDE_MENU.items = [];
    buildFieldGuideMenu(FIELD_GUIDE_MENU);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.FieldGuideMenu = {
    config: FIELD_GUIDE_MENU,
    rebuild: buildFieldGuideMenu,
    close: closeMenu
  };
}());
