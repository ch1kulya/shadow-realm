document.addEventListener("DOMContentLoaded", () => {
  window.addEventListener("load", () => {
    document.documentElement.classList.remove("no-transitions");
  });

  function initStatusBadge() {
    const widget = document.getElementById("status-widget");
    if (!widget) return;

    const dot = widget.querySelector(".footer-status-dot");
    const text = widget.querySelector(".status-text");

    if (!dot || !text) return;

    fetch("https://kappalib.ru/status")
      .then((res) => {
        if (!res.ok) throw new Error("Network response was not ok");
        return res.json();
      })
      .then((data) => {
        const indicator = data.status.indicator;
        const description = data.status.description;

        widget.classList.remove("operational", "degraded", "outage");
        text.textContent = description;

        switch (indicator) {
          case "none":
            widget.classList.add("operational");
            break;
          case "minor":
            widget.classList.add("degraded");
            break;
          case "major":
            widget.classList.add("outage");
            break;
          case "maintenance":
            widget.classList.add("degraded");
            break;
          default:
            dot.style.backgroundColor = "var(--text-color)";
            dot.style.opacity = "0.5";
        }
      })
      .catch((err) => {
        console.error("Failed to fetch status:", err);
        text.textContent = "Статус недоступен";
        dot.style.backgroundColor = "var(--text-color)";
        dot.style.opacity = "0.5";
      });
  }

  initStatusBadge();

  const readerContainer = document.querySelector(".reader-container");

  if (readerContainer) {
    loadChapters();
  } else {
    return;
  }

  console.log("Читалка готова!");

  const root = document.documentElement;
  const headerBtns = document.querySelectorAll(".header-btn[data-panel-id]");
  const panelsContainer = document.getElementById("panels-container");
  const overlay = document.querySelector(".panel-overlay");
  const readerHeader = document.querySelector(".reader-header");
  const floatingNav = document.querySelector(".floating-nav");
  if (floatingNav) {
    floatingNav.classList.add("visible");
  }

  const tocPanel = document.querySelector("#toc-panel");
  const searchInput = tocPanel.querySelector(".search-input");
  const chaptersListContainer = tocPanel.querySelector(".chapters-list");
  const sortBtn = tocPanel.querySelector(".sort-btn");

  const bookmarkBtn = document.getElementById("bookmark-btn");
  const settingControls = document.querySelectorAll("[data-setting]");

  let activePanelId = null;
  let isPanelAnimating = false;
  let readerBookmarks = [];
  let allChapters = [];
  let sortAscending = true;
  let lastScrollTop = 0;
  const PANEL_ANIMATION_DURATION = 200; // ms

  const offlineBtn = document.getElementById("offline-download-btn");
  const swPath = "/service-worker.js";

  function getTotalSizeBytes() {
    const buildSizeMB = window.BUILD_SIZE_MB || 0;
    if (buildSizeMB > 0) {
      return buildSizeMB * 1024 * 1024;
    }
    return 60 * 1024 * 1024; // 60 MB
  }

  function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return "0 байт";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["байт", "КБ", "МБ", "ГБ", "ТБ"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }

  function updateOfflineButtonState(state, data = {}) {
    if (!offlineBtn) return;

    const displayTotalSize = getTotalSizeBytes();

    switch (state) {
      case "ready":
        offlineBtn.disabled = false;
        offlineBtn.classList.remove("active");
        offlineBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-mr">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    Кэшировать ${formatBytes(displayTotalSize)}`;
        break;
      case "downloading":
        offlineBtn.disabled = true;
        offlineBtn.classList.add("active");
        const progressBytes = (data.count / data.total) * displayTotalSize;
        offlineBtn.textContent = `Кэширование... ${formatBytes(progressBytes)}/${formatBytes(displayTotalSize)}`;
        break;
      case "updating":
        offlineBtn.disabled = true;
        offlineBtn.classList.add("active");
        offlineBtn.textContent = `Обновление... (${data.count} из ${data.total} глав)`;
        break;
      case "complete":
        offlineBtn.disabled = true;
        offlineBtn.classList.add("active");
        offlineBtn.textContent = `Офлайн-доступ активен`;
        break;
      case "error":
        offlineBtn.disabled = false;
        offlineBtn.classList.remove("active");
        offlineBtn.textContent = "Ошибка! Попробовать снова?";
        break;
    }
  }

  function checkForUpdates() {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      console.log("Client: Checking for offline content updates...");
      navigator.serviceWorker.controller.postMessage({
        action: "check-for-updates",
      });
    }
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      if (offlineBtn) offlineBtn.style.display = "none";
      return;
    }

    if (offlineBtn) {
      const offlineStatus = localStorage.getItem("offline-status");
      const isOfflineReady =
        localStorage.getItem("offline-access-complete") === "true";

      if (isOfflineReady) {
        updateOfflineButtonState("complete");
      } else if (
        offlineStatus === "downloading" ||
        offlineStatus === "updating"
      ) {
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            action: "request-status",
          });
        }
      } else {
        updateOfflineButtonState("ready");
      }
    }

    try {
      const registration = await navigator.serviceWorker.register(swPath);
      console.log("Service Worker зарегистрирован:", registration);

      if (
        offlineBtn &&
        localStorage.getItem("offline-access-complete") === "true"
      ) {
        if (navigator.onLine) {
          checkForUpdates();
        }
      } else if (navigator.serviceWorker.controller) {
        if (localStorage.getItem("offline-status") === "downloading") {
          navigator.serviceWorker.controller.postMessage({
            action: "request-status",
          });
        }
      }

      navigator.serviceWorker.onmessage = (event) => {
        const { type, count, total, totalSize, upToDate } = event.data;

        switch (type) {
          case "caching-started":
            localStorage.setItem("offline-status", "downloading");
            if (total) localStorage.setItem("offline-progress-total", total);
            break;
          case "caching-progress":
            if (count) localStorage.setItem("offline-progress-count", count);
            updateOfflineButtonState("downloading", { count, total });
            break;
          case "caching-finished":
            localStorage.setItem("offline-status", "complete");
            localStorage.setItem("offline-access-complete", "true");
            if (totalSize)
              localStorage.setItem("offline-total-size", totalSize);
            ["offline-progress-count", "offline-progress-total"].forEach((k) =>
              localStorage.removeItem(k),
            );
            updateOfflineButtonState("complete", { totalSize });
            break;
          case "update-started":
            localStorage.setItem("offline-status", "updating");
            if (total) localStorage.setItem("offline-progress-total", total);
            break;
          case "update-progress":
            if (count) localStorage.setItem("offline-progress-count", count);
            updateOfflineButtonState("updating", { count, total });
            break;
          case "update-finished":
            localStorage.setItem("offline-status", "complete");
            if (totalSize)
              localStorage.setItem("offline-total-size", totalSize);
            ["offline-progress-count", "offline-progress-total"].forEach((k) =>
              localStorage.removeItem(k),
            );
            updateOfflineButtonState("complete", { totalSize });
            break;
          case "caching-error":
            updateOfflineButtonState("error");
            [
              "offline-status",
              "offline-access-complete",
              "offline-total-size",
              "offline-progress-count",
              "offline-progress-total",
            ].forEach((k) => localStorage.removeItem(k));
            break;
          case "update-error":
            console.error(
              "Не удалось проверить обновления. Существующий офлайн-кэш остаётся доступным.",
            );
            updateOfflineButtonState("complete");
            localStorage.setItem("offline-status", "complete");
            break;
        }
      };
    } catch (error) {
      console.error("Ошибка регистрации Service Worker:", error);
      if (offlineBtn) updateOfflineButtonState("error");
    }
  }

  if (offlineBtn) {
    offlineBtn.addEventListener("click", () => {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        localStorage.setItem("offline-status", "downloading");
        updateOfflineButtonState("downloading", { count: 0, total: 1 });
        navigator.serviceWorker.controller.postMessage({ action: "cache-all" });
      } else {
        alert(
          "Сервис для офлайн-доступа еще не готов. Пожалуйста, перезагрузите страницу и попробуйте снова.",
        );
      }
    });
  }

  registerServiceWorker();

  const settings = {
    theme: "system",
    font: "lora",
    "font-size": "1.125",
    align: "left",
    indent: "0",
  };

  function detectSystemTheme() {
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function applyTheme(theme) {
    if (theme === "system") {
      const systemTheme = detectSystemTheme();
      document.documentElement.classList.toggle(
        "dark-theme",
        systemTheme === "dark",
      );
    } else {
      document.documentElement.classList.toggle("dark-theme", theme === "dark");
    }
  }

  function applySetting(name, value) {
    settings[name] = value;
    localStorage.setItem("readerSettings", JSON.stringify(settings));

    switch (name) {
      case "theme":
        applyTheme(value);
        break;
      case "font":
        root.style.setProperty(
          "--reader-font-family",
          `var(--font-family-${value})`,
        );
        break;
      case "font-size":
        root.style.setProperty("--reader-font-size", `${value}rem`);
        break;
      case "align":
        root.style.setProperty("--reader-text-align", value);
        break;
      case "indent":
        root.style.setProperty("--reader-paragraph-indent", `${value}rem`);
        break;
    }
  }

  function loadSettings() {
    const savedSettings =
      JSON.parse(localStorage.getItem("readerSettings")) || {};

    if (
      savedSettings["font-size"] &&
      parseFloat(savedSettings["font-size"]) > 2
    ) {
      savedSettings["font-size"] = (
        parseFloat(savedSettings["font-size"]) / 16
      ).toFixed(3);
    }

    Object.assign(settings, savedSettings);

    if (!savedSettings.theme) {
      settings.theme = "system";
    }
    applyTheme(settings.theme);
    if (settings.font)
      root.style.setProperty(
        "--reader-font-family",
        `var(--font-family-${settings.font})`,
      );
    if (settings["font-size"])
      root.style.setProperty(
        "--reader-font-size",
        `${settings["font-size"]}rem`,
      );
    if (settings.align)
      root.style.setProperty("--reader-text-align", settings.align);
    if (settings.indent)
      root.style.setProperty(
        "--reader-paragraph-indent",
        `${settings.indent}rem`,
      );

    updateControls();
  }

  if (window.matchMedia) {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", (e) => {
        if (settings.theme === "system") {
          applyTheme("system");
        }
      });
  }

  function getDesiredPanelHeight() {
    const settingsPanel = document.getElementById("settings-panel");
    if (!settingsPanel) return 0;

    const content =
      settingsPanel.querySelector(".panel-content") || settingsPanel;

    if (settingsPanel.classList.contains("active")) {
      return (
        content.scrollHeight +
        parseFloat(getComputedStyle(settingsPanel).paddingTop) +
        parseFloat(getComputedStyle(settingsPanel).paddingBottom)
      );
    }

    const prevDisplay = settingsPanel.style.display;
    const prevVisibility = settingsPanel.style.visibility;
    const prevPosition = settingsPanel.style.position;

    settingsPanel.style.display = "block";
    settingsPanel.style.visibility = "hidden";
    settingsPanel.style.position = "absolute";

    const h =
      content.scrollHeight +
      parseFloat(getComputedStyle(settingsPanel).paddingTop) +
      parseFloat(getComputedStyle(settingsPanel).paddingBottom);

    settingsPanel.style.display = prevDisplay;
    settingsPanel.style.visibility = prevVisibility;
    settingsPanel.style.position = prevPosition;

    return h;
  }

  function updatePanelsContainerHeight() {
    const targetHeight = getDesiredPanelHeight();
    if (!targetHeight) return;
    panelsContainer.style.height = targetHeight + "px";
  }

  function closePanel() {
    if (!activePanelId || isPanelAnimating) return;

    panelsContainer.style.height = panelsContainer.offsetHeight + "px";

    isPanelAnimating = true;
    const panelToClose = document.getElementById(activePanelId);
    const btnToDeactivate = document.querySelector(
      `.header-btn[data-panel-id="${activePanelId}"]`,
    );

    panelToClose.classList.add("closing", "panel-scroll-hidden");
    if (btnToDeactivate) btnToDeactivate.classList.remove("active");

    requestAnimationFrame(() => {
      panelsContainer.style.height = "0px";
    });

    setTimeout(() => {
      readerHeader.classList.remove("panel-active");
      panelsContainer.classList.remove("visible");
      overlay.classList.remove("active");

      panelToClose.classList.remove("active", "closing", "panel-scroll-hidden");

      panelsContainer.style.height = "";

      activePanelId = null;
      isPanelAnimating = false;

      if (window._centerTocTimeout) {
        clearTimeout(window._centerTocTimeout);
        window._centerTocTimeout = null;
      }
    }, PANEL_ANIMATION_DURATION);
  }

  function openPanel(panelId) {
    if (isPanelAnimating) return;

    const firstOpen = !activePanelId;

    if (activePanelId && activePanelId !== panelId) {
      document.getElementById(activePanelId).classList.remove("active");
      const currentBtn = document.querySelector(
        `.header-btn[data-panel-id="${activePanelId}"]`,
      );
      if (currentBtn) currentBtn.classList.remove("active");
    } else if (!activePanelId) {
      readerHeader.classList.add("panel-active");
      panelsContainer.classList.add("visible");
      overlay.classList.add("active");
    }

    const panelElement = document.getElementById(panelId);
    panelElement.classList.add("active", "panel-scroll-hidden");
    const newBtn = document.querySelector(
      `.header-btn[data-panel-id="${panelId}"]`,
    );
    if (newBtn) newBtn.classList.add("active");
    activePanelId = panelId;

    if (panelId === "toc-panel" && !chaptersListContainer.dataset.rendered) {
      const query = searchInput.value.toLowerCase();
      const filtered = query
        ? allChapters.filter(
            (c) =>
              c.title.toLowerCase().includes(query) ||
              String(c.number).includes(query),
          )
        : allChapters;
      renderChapterList(filtered);
      updateSortIcon();
      chaptersListContainer.dataset.rendered = "true";
    }

    if (firstOpen) {
      requestAnimationFrame(updatePanelsContainerHeight);
    } else {
      updatePanelsContainerHeight();
    }

    setTimeout(() => {
      panelElement.classList.remove("panel-scroll-hidden");
    }, PANEL_ANIMATION_DURATION);
  }

  function switchPanel(panelId) {
    if (isPanelAnimating || !activePanelId || activePanelId === panelId) return;

    isPanelAnimating = true;

    const currentPanel = document.getElementById(activePanelId);
    const nextPanel = document.getElementById(panelId);
    if (!currentPanel || !nextPanel) {
      isPanelAnimating = false;
      return;
    }

    const currentBtn = document.querySelector(
      `.header-btn[data-panel-id="${activePanelId}"]`,
    );
    const nextBtn = document.querySelector(
      `.header-btn[data-panel-id="${panelId}"]`,
    );

    if (currentBtn) currentBtn.classList.remove("active");
    if (nextBtn) nextBtn.classList.add("active");

    currentPanel.classList.add("fade-out", "panel-scroll-hidden");

    setTimeout(() => {
      currentPanel.classList.remove(
        "active",
        "fade-out",
        "panel-scroll-hidden",
      );

      nextPanel.classList.add(
        "active",
        "fade-in",
        "panel-scroll-hidden",
        "no-slide",
      );
      activePanelId = panelId;

      updatePanelsContainerHeight();

      setTimeout(() => {
        nextPanel.classList.remove("fade-in", "panel-scroll-hidden");
        isPanelAnimating = false;
      }, PANEL_ANIMATION_DURATION);
    }, PANEL_ANIMATION_DURATION);

    if (window._centerTocTimeout) {
      clearTimeout(window._centerTocTimeout);
      window._centerTocTimeout = null;
    }
  }

  function togglePanel(panelId) {
    if (activePanelId === panelId) {
      closePanel();
    } else if (activePanelId) {
      switchPanel(panelId);
      if (panelId === "toc-panel") {
        if (window._centerTocTimeout) clearTimeout(window._centerTocTimeout);
        window._centerTocTimeout = setTimeout(
          () => centerCurrentChapter(),
          451,
        );
      }
    } else {
      openPanel(panelId);
      if (panelId === "toc-panel") {
        if (window._centerTocTimeout) clearTimeout(window._centerTocTimeout);
        window._centerTocTimeout = setTimeout(
          () => centerCurrentChapter(),
          451,
        );
      }
    }
  }

  function saveBookmarks() {
    localStorage.setItem("readerBookmarks", JSON.stringify(readerBookmarks));
  }
  function loadBookmarks() {
    readerBookmarks = JSON.parse(localStorage.getItem("readerBookmarks")) || [];
  }
  function isChapterBookmarked(num) {
    return readerBookmarks.some((b) => b.number === num);
  }

  function updateBookmarkStatus() {
    const chapterNumber = parseInt(readerContainer.dataset.chapterNumber, 10);
    if (isChapterBookmarked(chapterNumber)) {
      bookmarkBtn.classList.add("bookmarked");
      bookmarkBtn.title = "Удалить из закладок";
    } else {
      bookmarkBtn.classList.remove("bookmarked");
      bookmarkBtn.title = "Добавить в закладки";
    }
  }

  function toggleBookmark() {
    const chapterNumber = parseInt(readerContainer.dataset.chapterNumber, 10);
    const chapterTitle = readerContainer.dataset.chapterTitle;
    const chapterUrl = readerContainer.dataset.chapterUrl;
    if (isChapterBookmarked(chapterNumber)) {
      readerBookmarks = readerBookmarks.filter(
        (b) => b.number !== chapterNumber,
      );
    } else {
      readerBookmarks.push({
        number: chapterNumber,
        title: chapterTitle,
        url: chapterUrl,
      });
    }
    saveBookmarks();
    updateBookmarkStatus();
  }

  function updateControls() {
    settingControls.forEach((control) => {
      const { setting, value } = control.dataset;
      if (control.type === "range") {
        control.value = settings[setting];
      } else if (control.tagName === "SELECT") {
        control.value = settings[setting];
      } else {
        if (value === settings[setting]) {
          const group =
            control.closest(".btn-group") ||
            control.closest(".theme-options") ||
            control.closest(".icon-group");
          if (group)
            group
              .querySelectorAll("button")
              .forEach((b) => b.classList.remove("active"));
          control.classList.add("active");
        }
      }
    });
  }

  function getChapterUrl(number) {
    return "/chapters/" + String(number).padStart(4, "0") + "/";
  }

  function renderChapterList(chapters) {
    chaptersListContainer.innerHTML = "";
    const fragment = document.createDocumentFragment();
    const currentChapterNumber = parseInt(
      readerContainer.dataset.chapterNumber,
      10,
    );

    chapters.forEach((chapter) => {
      const li = document.createElement("li");
      li.dataset.chapterNumber = chapter.number;

      if (chapter.number === currentChapterNumber) {
        li.classList.add("current");
      }

      const chapterUrl = getChapterUrl(chapter.number);

      const isBookmarked = isChapterBookmarked(chapter.number);
      const bookmarkIcon = isBookmarked
        ? `<svg class="toc-bookmark-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`
        : "";

      li.innerHTML = `
                  <a href="${chapterUrl}">
                      <span class="chapter-num">${chapter.number}.</span>
                      <span class="chapter-title">${chapter.title}</span>
                      ${bookmarkIcon}
                  </a>`;
      fragment.appendChild(li);
    });
    chaptersListContainer.appendChild(fragment);
  }

  async function loadChapters() {
    try {
      const response = await fetch("/assets/index/chapters.json");
      allChapters = await response.json();
      renderChapterList(allChapters);
    } catch (error) {
      chaptersListContainer.innerHTML =
        "<li>Не удалось загрузить список глав.</li>";
    }
  }

  headerBtns.forEach((btn) =>
    btn.addEventListener("click", () => {
      const panelId = btn.dataset.panelId;
      if (panelId) togglePanel(panelId);
    }),
  );

  bookmarkBtn.addEventListener("click", toggleBookmark);
  overlay.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });

  settingControls.forEach((control) => {
    const eventType =
      control.type === "range"
        ? "input"
        : control.tagName === "SELECT"
          ? "change"
          : "click";
    control.addEventListener(eventType, () => {
      const { setting, value } = control.dataset;
      const newVal =
        control.type === "range"
          ? control.value
          : control.tagName === "SELECT"
            ? control.value
            : value;
      applySetting(setting, newVal);
      if (eventType !== "input") updateControls();
    });
  });

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.toLowerCase();
    renderChapterList(
      allChapters.filter(
        (c) =>
          c.title.toLowerCase().includes(query) ||
          String(c.number).includes(query),
      ),
    );
  });

  function updateSortIcon() {
    sortBtn.innerHTML = sortAscending
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="7" x2="6" y2="7"></line><line x1="3" y1="12" x2="12" y2="12"></line><line x1="3" y1="17" x2="18" y2="17"></line></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="7" x2="18" y2="7"></line><line x1="3" y1="12" x2="12" y2="12"></line><line x1="3" y1="17" x2="6" y2="17"></line></svg>`;
  }

  sortBtn.addEventListener("click", () => {
    sortAscending = !sortAscending;
    allChapters.reverse();
    const query = searchInput.value.toLowerCase();
    renderChapterList(
      allChapters.filter((c) => c.title.toLowerCase().includes(query)),
    );
    updateSortIcon();
    centerCurrentChapter();
  });

  updateSortIcon();

  let scrollDirection = null;
  let scrollThreshold = 0;

  function handleScroll() {
    let scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    let currentDirection = scrollTop > lastScrollTop ? "down" : "up";

    if (scrollDirection !== currentDirection) {
      scrollDirection = currentDirection;
      scrollThreshold = 0;
    }

    if (scrollDirection === currentDirection) {
      scrollThreshold += Math.abs(scrollTop - lastScrollTop);
    }

    if (scrollThreshold >= 10) {
      if (scrollTop > lastScrollTop && scrollTop > 40) {
        readerHeader.classList.add("hidden");
        if (activePanelId) closePanel();
        if (floatingNav) floatingNav.classList.remove("visible");
      } else {
        readerHeader.classList.remove("hidden");
        if (floatingNav) floatingNav.classList.add("visible");
      }
    }

    lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
  }

  const endSentinel = document.getElementById("content-end-sentinel");
  if (endSentinel && floatingNav) {
    new IntersectionObserver(
      (e) => {
        floatingNav.classList.toggle("end-reached", e[0].isIntersecting);
      },
      { root: null, rootMargin: "0px 0px -60px 0px" },
    ).observe(endSentinel);
  }

  window.addEventListener("scroll", handleScroll, false);

  loadSettings();
  loadBookmarks();
  updateBookmarkStatus();

  const readerFooter = document.querySelector(".site-footer");

  function updateFloatingNavPosition() {
    if (!floatingNav || !readerFooter) return;

    const footerRect = readerFooter.getBoundingClientRect();
    const windowHeight = window.innerHeight;

    const safeAreaBottom =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--safe-area-bottom",
        ),
      ) || 0;

    const defaultBottom = 24 + safeAreaBottom;

    if (footerRect.top < windowHeight) {
      const newBottom = windowHeight - footerRect.top + 15;
      floatingNav.style.bottom =
        (newBottom > defaultBottom ? newBottom : defaultBottom) + "px";
    } else {
      floatingNav.style.bottom = defaultBottom + "px";
    }
  }

  window.addEventListener("scroll", updateFloatingNavPosition);
  window.addEventListener("resize", updateFloatingNavPosition);

  if (floatingNav) {
    floatingNav.classList.add("visible");
    updateFloatingNavPosition();
  }

  function centerCurrentChapter() {
    const currentChapterNumber = readerContainer.dataset.chapterNumber;
    const activeLi = chaptersListContainer.querySelector(
      `li[data-chapter-number="${currentChapterNumber}"]`,
    );
    if (!activeLi) return;
    activeLi.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    return;
  }
});
