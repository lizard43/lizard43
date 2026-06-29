/*
  Astrocade Arcade Field Guide shared hamburger / TOC menu.

  Use on every page with:
    <link rel="stylesheet" href="field-guide.css" />
    <script src="menu.js" defer></script>

  The script injects the hamburger controls directly after <body> and inserts
  the off-canvas <nav class="toc"> as the first child of <main>.
  Edit FIELD_GUIDE_MENU below to maintain the TOC in one place.
*/
(function () {
  "use strict";

  const FIELD_GUIDE_MENU = {
    title: "Field Guide TOC",
    buttonLabel: "Open or close chapter map",
    buttonText: "Chapter Map",
    items: [
      { label: "Intro", href: "index.html" },
      { label: "Chapter 01: Machine Model", href: "machine-model.html" },
      { label: "Chapter 02: I/O Map", href: "io-map.html" },
      { label: "Chapter 03: Video System", href: "video-system.html" },
      { label: "Chapter 04: Inputs and DIP Switches", href: "inputs-dip-switches.html" },
      { label: "Chapter 05: Sound", href: "sound.html" },
      { label: "Chapter 06: Pattern Board", href: "pattern-board.html" }
    ]
  };

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

  function pageNameFromHref(href) {
    try {
      const url = new URL(href, window.location.href);
      const pathname = url.pathname.replace(/\/+$/, "");
      return pathname.split("/").pop() || "index.html";
    } catch (error) {
      const cleaned = String(href || "").split(/[?#]/)[0].replace(/\/+$/, "");
      return cleaned.split("/").pop() || "index.html";
    }
  }

  function isCurrentPage(href) {
    const current = pageNameFromHref(window.location.href);
    const target = pageNameFromHref(href);

    if (current === target) {
      return true;
    }

    // Treat a directory URL as index.html.
    return current === "" && target === "index.html";
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

  function buildToc(menu) {
    const main = document.querySelector("main");
    if (!main) {
      return null;
    }

    const nav = makeElement("nav", "toc");
    nav.setAttribute("aria-label", "Table of contents");
    nav.dataset.menuManaged = "true";

    nav.append(makeElement("h2", "", menu.title || "Field Guide TOC"));

    (menu.items || []).forEach(function (item) {
      const link = makeElement("a", "", item.label || item.href || "Untitled");
      link.href = item.href || "#";

      if (item.title) {
        link.title = item.title;
      }

      if (item.target) {
        link.target = item.target;
      }

      if (item.rel) {
        link.rel = item.rel;
      }

      if (isCurrentPage(link.getAttribute("href"))) {
        link.setAttribute("aria-current", "page");
      }

      if (item.note) {
        link.append(makeElement("small", "", item.note));
      }

      nav.append(link);
    });

    const content = main.querySelector(":scope > .content");
    main.insertBefore(nav, content || main.firstChild);
    return nav;
  }

  function bindMenuBehavior(toggle, nav) {
    if (!toggle) {
      return;
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        toggle.checked = false;
      }
    });

    if (nav) {
      nav.addEventListener("click", function (event) {
        if (event.target.closest("a")) {
          toggle.checked = false;
        }
      });
    }
  }

  function buildFieldGuideMenu(menu) {
    const previousToggle = document.getElementById("toc-toggle");
    const wasOpen = Boolean(previousToggle && previousToggle.checked);

    removeExistingMenuShell();

    const toggle = buildToggleShell(menu);
    const nav = buildToc(menu);
    toggle.checked = wasOpen;

    bindMenuBehavior(toggle, nav);
  }

  function init() {
    buildFieldGuideMenu(FIELD_GUIDE_MENU);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.FieldGuideMenu = {
    config: FIELD_GUIDE_MENU,
    rebuild: buildFieldGuideMenu
  };
}());
