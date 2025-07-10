(function() {
    // Проверяем, поддерживает ли браузер History API и Fetch
    if (!window.history.pushState || !window.fetch) return; // graceful degradation

    /**
     * Проверяем, является ли ссылка переходом на главу.
     * @param {HTMLAnchorElement} a
     */
    function isChapterLink(a) {
        if (!a) return false;
        const url = new URL(a.href);
        // Только тот же домен и путь /chapters/.../
        return url.origin === location.origin && url.pathname.startsWith('/chapters/');
    }

    // --- Индикатор загрузки главы и утилита скролла ---
    const chapterLoader = (() => {
        const el = document.createElement('div');
        el.className = 'chapter-loading-overlay';
        el.hidden = true;
        document.body.appendChild(el);
        return el;
    })();

    function showChapterLoader() { chapterLoader.hidden = false; }
    function hideChapterLoader() { chapterLoader.hidden = true; }

    function scrollToPageTop() {
        // Детект iOS
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        if (isIOS) {
            setTimeout(() => window.scrollTo(0, -25), 151);
        } else {
            // Для других браузеров
            window.scrollTo(0, 0);
        }
    }

    /**
     * Выполняет SPA-переход к заданному URL.
     * @param {string} url
     * @param {boolean} replace true, если нужно заменить запись в истории (popstate)
     */
    async function goto(url, replace = false) {
        showChapterLoader();
        try {
            const response = await fetch(url, {
                headers: { 'X-Requested-With': 'spa' },
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const html = await response.text();

            // Парсим полученный HTML
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const newContainer = doc.querySelector('.reader-container');
            const oldContainer = document.querySelector('.reader-container');
            if (!newContainer || !oldContainer) {
                location.href = url; // Фолбэк, если что-то пошло не так
                return;
            }

            // Обновляем <title>
            document.title = doc.title;

            // Копируем ключевые data-атрибуты контейнера (используем camelCase для dataset)
            ['chapterNumber', 'chapterTitle', 'chapterUrl'].forEach(key => {
                if (newContainer.dataset[key] !== undefined) {
                    oldContainer.dataset[key] = newContainer.dataset[key];
                }
            });

            // Обновляем содержимое главы
            const newContent = newContainer.querySelector('.chapter-content');
            const oldContent = oldContainer.querySelector('.chapter-content');
            if (newContent && oldContent) {
                oldContent.innerHTML = newContent.innerHTML;
            }

            // Обновляем навигационные стрелки без замены самого элемента,
            // чтобы не терять прикреплённые слушатели/классы
            const newFloatNav = newContainer.querySelector('.floating-nav');
            const oldFloatNav = oldContainer.querySelector('.floating-nav');
            if (newFloatNav && oldFloatNav) {
                // Копируем содержимое
                oldFloatNav.innerHTML = newFloatNav.innerHTML;
                // Копируем атрибуты (например, data-*)
                [...oldFloatNav.attributes].forEach(attr => {
                    if (!newFloatNav.hasAttribute(attr.name)) {
                        oldFloatNav.removeAttribute(attr.name);
                    }
                });
                [...newFloatNav.attributes].forEach(attr => {
                    oldFloatNav.setAttribute(attr.name, attr.value);
                });
                // Убедимся, что класс visible присутствует
                oldFloatNav.classList.add('visible');

                // Обновляем ссылки стрелок, не трогая позиционирование
                const oldPrev = oldFloatNav.querySelector('a.nav-arrow[title="Предыдущая глава"]');
                const oldNext = oldFloatNav.querySelector('a.nav-arrow[title="Следующая глава"]');
                const newPrev = newFloatNav.querySelector('a.nav-arrow[title="Предыдущая глава"]');
                const newNext = newFloatNav.querySelector('a.nav-arrow[title="Следующая глава"]');

                function syncLink(oldLink, newLink) {
                    if (newLink) {
                        if (!oldLink) {
                            // Если раньше не было, просто вставляем клонированную ссылку
                            oldFloatNav.insertBefore(newLink.cloneNode(true), oldFloatNav.firstChild);
                        } else {
                            oldLink.href = newLink.href;
                        }
                    } else if (oldLink) {
                        // Если новой ссылки нет, убираем старую и замещаем div-заглушкой для flex
                        const placeholder = document.createElement('div');
                        oldLink.replaceWith(placeholder);
                    }
                }

                syncLink(oldPrev, newPrev);
                syncLink(oldNext, newNext);
            }

            // Сбрасываем скролл в начало
            scrollToPageTop();

            // Триггерим перерасчёт позиции плавающей навигации
            window.dispatchEvent(new Event('scroll'));

            // Обновляем историю
            if (replace) {
                history.replaceState(null, '', url);
            } else {
                history.pushState(null, '', url);
            }

            // Подсвечиваем активную главу в оглавлении
            const currentNum = oldContainer.dataset.chapterNumber;
            document.querySelectorAll('.chapters-list li').forEach(li => {
                li.classList.toggle('current', li.dataset.chapterNumber === currentNum);
            });

            // Синхронизируем UI закладок для новой главы
            syncBookmarkUI();
        } catch (err) {
            console.error('SPA navigation failed, falling back to full reload', err);
            location.href = url;
        } finally {
            hideChapterLoader();
        }
    }

    /** Синхронизирует кнопку-закладку и иконки в списке глав */
    function syncBookmarkUI() {
        const container = document.querySelector('.reader-container');
        const bookmarkBtn = document.getElementById('bookmark-btn');
        const chapterNumber = container ? parseInt(container.dataset.chapterNumber, 10) : null;
        if (!bookmarkBtn || chapterNumber === null) return;

        const bookmarks = JSON.parse(localStorage.getItem('readerBookmarks')) || [];
        const isBookmarked = bookmarks.some(b => b.number === chapterNumber);

        bookmarkBtn.classList.toggle('bookmarked', isBookmarked);
        bookmarkBtn.title = isBookmarked ? 'Удалить из закладок' : 'Добавить в закладки';

        // Обновляем значки в списке глав
        document.querySelectorAll('.chapters-list li').forEach(li => {
            const num = parseInt(li.dataset.chapterNumber, 10);
            const anchor = li.querySelector('a');
            const existingIcon = li.querySelector('.toc-bookmark-icon');
            const needIcon = bookmarks.some(b => b.number === num);

            if (needIcon && !existingIcon) {
                anchor.insertAdjacentHTML('beforeend', `<svg class="toc-bookmark-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`);
            } else if (!needIcon && existingIcon) {
                existingIcon.remove();
            }
        });
    }

    // Перехватываем клики по ссылкам
    document.addEventListener('click', e => {
        if (e.defaultPrevented) return;
        const a = e.target.closest('a[href]');
        if (!a || a.dataset.noSpa !== undefined) return;
        if (!isChapterLink(a)) return;
        e.preventDefault();
        goto(a.href);
    });

    // Обрабатываем навигацию через кнопки браузера
    window.addEventListener('popstate', () => goto(location.pathname, true));

    // При клике на кнопку закладки после её внутренней обработки в main.js
    const bmBtn = document.getElementById('bookmark-btn');
    if (bmBtn) {
        bmBtn.addEventListener('click', () => {
            // маленькая задержка, чтобы main.js успел изменить localStorage
            setTimeout(syncBookmarkUI, 10);
        });
    }
})(); 