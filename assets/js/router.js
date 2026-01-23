(function () {
  if (!window.history.pushState || !window.fetch) return;

  function isChapterLink(a) {
    if (!a) return false;
    const url = new URL(a.href);
    return (
      url.origin === location.origin && url.pathname.startsWith("/chapters/")
    );
  }

  const chapterLoader = (() => {
    const el = document.createElement("div");
    el.className = "chapter-loading-overlay";
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  })();

  function showChapterLoader() {
    chapterLoader.hidden = false;
  }
  function hideChapterLoader() {
    chapterLoader.hidden = true;
  }

  function refreshAdBanner() {
    const container = document.querySelector(".ad-banner");
    if (!container) return;

    container.innerHTML = `
      <ins class="mrg-tag"
        style="display:inline-block;width:320px;height:50px"
        data-ad-client="ad-1966778"
        data-ad-slot="1966778">
      </ins>
    `;

    (window.MRGtag = window.MRGtag || []).push({});
  }

  function scrollToPageTop() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      setTimeout(() => window.scrollTo(0, -25), 25);
    } else {
      window.scrollTo(0, 0);
    }
  }

  async function goto(url, replace = false) {
    showChapterLoader();
    try {
      const response = await fetch(url, {
        headers: { "X-Requested-With": "spa" },
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const html = await response.text();

      const doc = new DOMParser().parseFromString(html, "text/html");
      const newContainer = doc.querySelector(".reader-container");
      const oldContainer = document.querySelector(".reader-container");
      if (!newContainer || !oldContainer) {
        location.href = url;
        return;
      }

      document.title = doc.title;

      ["chapterNumber", "chapterTitle", "chapterUrl"].forEach((key) => {
        if (newContainer.dataset[key] !== undefined) {
          oldContainer.dataset[key] = newContainer.dataset[key];
        }
      });

      const newContent = newContainer.querySelector(".chapter-content");
      const oldContent = oldContainer.querySelector(".chapter-content");
      if (newContent && oldContent) {
        oldContent.innerHTML = newContent.innerHTML;
      }

      const newFloatNav = newContainer.querySelector(".floating-nav");
      const oldFloatNav = oldContainer.querySelector(".floating-nav");
      if (newFloatNav && oldFloatNav) {
        oldFloatNav.innerHTML = newFloatNav.innerHTML;
        [...oldFloatNav.attributes].forEach((attr) => {
          if (!newFloatNav.hasAttribute(attr.name)) {
            oldFloatNav.removeAttribute(attr.name);
          }
        });
        [...newFloatNav.attributes].forEach((attr) => {
          oldFloatNav.setAttribute(attr.name, attr.value);
        });
        oldFloatNav.classList.add("visible");

        const oldPrev = oldFloatNav.querySelector(
          'a.nav-arrow[title="Предыдущая глава"]',
        );
        const oldNext = oldFloatNav.querySelector(
          'a.nav-arrow[title="Следующая глава"]',
        );
        const newPrev = newFloatNav.querySelector(
          'a.nav-arrow[title="Предыдущая глава"]',
        );
        const newNext = newFloatNav.querySelector(
          'a.nav-arrow[title="Следующая глава"]',
        );

        function syncLink(oldLink, newLink) {
          if (newLink) {
            if (!oldLink) {
              oldFloatNav.insertBefore(
                newLink.cloneNode(true),
                oldFloatNav.firstChild,
              );
            } else {
              oldLink.href = newLink.href;
            }
          } else if (oldLink) {
            const placeholder = document.createElement("div");
            oldLink.replaceWith(placeholder);
          }
        }

        syncLink(oldPrev, newPrev);
        syncLink(oldNext, newNext);
      }

      scrollToPageTop();

      window.dispatchEvent(new Event("scroll"));

      if (replace) {
        history.replaceState(null, "", url);
      } else {
        history.pushState(null, "", url);
      }

      const currentNum = oldContainer.dataset.chapterNumber;
      document.querySelectorAll(".chapters-list li").forEach((li) => {
        li.classList.toggle("current", li.dataset.chapterNumber === currentNum);
      });

      syncBookmarkUI();
      refreshAdBanner();
    } catch (err) {
      console.error("SPA navigation failed, falling back to full reload", err);
      location.href = url;
    } finally {
      hideChapterLoader();
    }
  }

  function syncBookmarkUI() {
    const container = document.querySelector(".reader-container");
    const bookmarkBtn = document.getElementById("bookmark-btn");
    const chapterNumber = container
      ? parseInt(container.dataset.chapterNumber, 10)
      : null;
    if (!bookmarkBtn || chapterNumber === null) return;

    const bookmarks = JSON.parse(localStorage.getItem("readerBookmarks")) || [];
    const isBookmarked = bookmarks.some((b) => b.number === chapterNumber);

    bookmarkBtn.classList.toggle("bookmarked", isBookmarked);
    bookmarkBtn.title = isBookmarked
      ? "Удалить из закладок"
      : "Добавить в закладки";

    document.querySelectorAll(".chapters-list li").forEach((li) => {
      const num = parseInt(li.dataset.chapterNumber, 10);
      const anchor = li.querySelector("a");
      const existingIcon = li.querySelector(".toc-bookmark-icon");
      const needIcon = bookmarks.some((b) => b.number === num);

      if (needIcon && !existingIcon) {
        anchor.insertAdjacentHTML(
          "beforeend",
          `<svg class="toc-bookmark-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`,
        );
      } else if (!needIcon && existingIcon) {
        existingIcon.remove();
      }
    });
  }

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    const a = e.target.closest("a[href]");
    if (!a || a.dataset.noSpa !== undefined) return;
    if (!isChapterLink(a)) return;
    e.preventDefault();
    goto(a.href);
  });

  window.addEventListener("popstate", () => goto(location.pathname, true));

  const bmBtn = document.getElementById("bookmark-btn");
  if (bmBtn) {
    bmBtn.addEventListener("click", () => {
      setTimeout(syncBookmarkUI, 10);
    });
  }
})();
