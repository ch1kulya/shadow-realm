---
layout: default
title: Главная
---
<div class="welcome-container">
  <div class="stats-container">
    <span class="status-dot"></span>
    <span>Доступно глав: {{ site.chapters.size }}</span>
  </div>

  <div class="welcome-center-content">
    <div class="book-container">
      <div class="title-container">
        <h1>Теневой Раб</h1>
        <span class="subtitle">Shadow Slave</span>
      </div>
    </div>

    <div class="description">
      <p>Избранный Заклятием Кошмара, Санни попадает в разрушенный магический мир. Там он, как один из Пробужденных со сверхъестественными способностями, должен выживать в смертельной битве с монстрами. Но его божественная сила имеет опасный побочный эффект...</p>
    </div>
    
    {% assign chapters_for_start = site.chapters | where_exp:"item", "item.chapter_number > 0" | sort: 'name' %}
    {% assign first_chapter = chapters_for_start | first %}
    {% if first_chapter %}
      <a href="{{ first_chapter.url | relative_url }}" class="btn-start-reading">Начать читать</a>
    {% else %}
      <p>Главы еще не добавлены.</p>
    {% endif %}
  </div>
  <div class="welcome-footer">
    <a href="{{ '/translators' | relative_url }}">О переводчиках</a>
    <a href="{{ '/dmca' | relative_url }}">DMCA</a>
    <a href="{{ '/rights' | relative_url }}">Правообладателям</a>
    <a href="{{ '/privacy' | relative_url }}">Политика конфиденциальности</a>
  </div>
</div>
<script>
  document.addEventListener('DOMContentLoaded', function() {
    const startReadingBtn = document.querySelector('.btn-start-reading');
    if (!startReadingBtn) return;

    try {
      const bookmarks = JSON.parse(localStorage.getItem('readerBookmarks')) || [];
      if (bookmarks.length > 0) {
        const lastBookmark = bookmarks[bookmarks.length - 1];
        const baseUrl = '{{ "" | relative_url }}';
        
        if (lastBookmark && lastBookmark.url) {
            startReadingBtn.href = baseUrl + lastBookmark.url;
            startReadingBtn.textContent = 'Продолжить чтение';
        }
      }
    } catch (e) {
      console.error("Не удалось обработать закладки для кнопки 'Начать читать':", e);
    }
  });
</script> 