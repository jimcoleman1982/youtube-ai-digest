/**
 * Main application logic for YouTube AI Digest.
 * Handles data fetching, day-grouped accordion rendering,
 * filtering, search, pagination, and card interactions.
 */
const DigestApp = (() => {
  // State
  let allSummaries = [];
  let filteredSummaries = [];
  let expandedCards = new Set();
  let fullSummaryCache = {};
  let currentPage = 1;
  let hasMore = false;
  let channels = [];

  // Filters
  let filterChannel = '';
  let filterUnread = false;
  let searchQuery = '';

  // DOM refs
  const feed = document.getElementById('feed');
  const skeleton = document.getElementById('feed-skeleton');
  const emptyState = document.getElementById('empty-state');
  const loadMoreWrap = document.getElementById('load-more');
  const loadMoreBtn = document.getElementById('load-more-btn');
  const statsNew = document.getElementById('stats-new');
  const statsReadTime = document.getElementById('stats-read-time');
  const statsUnread = document.getElementById('stats-unread');

  // --- Data Fetching ---

  async function fetchSummaries(page) {
    const params = new URLSearchParams({ page: String(page) });
    if (filterChannel) params.set('channel', filterChannel);
    if (searchQuery) params.set('search', searchQuery);

    const res = await fetch(`/api/summaries?${params}`);
    return res.json();
  }

  async function fetchFullSummary(videoId) {
    if (fullSummaryCache[videoId]) return fullSummaryCache[videoId];
    const res = await fetch(`/api/summaries/${videoId}`);
    const data = await res.json();
    fullSummaryCache[videoId] = data;
    return data;
  }

  async function fetchChannels() {
    try {
      const res = await fetch('/api/channels');
      channels = await res.json();
      populateChannelFilter();
    } catch { /* ok */ }
  }

  // --- Init ---

  async function init() {
    fetchChannels();
    bindFilterEvents();
    bindLoadMore();
    await loadPage(1);
  }

  async function loadPage(page) {
    try {
      const data = await fetchSummaries(page);
      if (page === 1) {
        allSummaries = data.summaries || [];
      } else {
        allSummaries = allSummaries.concat(data.summaries || []);
      }
      hasMore = data.hasMore;
      currentPage = page;
    } catch {
      allSummaries = [];
      hasMore = false;
    }

    applyFilters();
    render();
    updateStats();
  }

  // --- Filtering ---

  function applyFilters() {
    let list = [...allSummaries];

    if (filterUnread) {
      const read = DigestState.getReadSet();
      list = list.filter(s => !read.has(s.videoId));
    }

    filteredSummaries = list;
  }

  function bindFilterEvents() {
    // Channel filter
    const channelSelect = document.getElementById('filter-channel-select');
    const channelLabel = document.getElementById('filter-channel-label');
    channelSelect.addEventListener('change', () => {
      filterChannel = channelSelect.value;
      channelLabel.textContent = channelSelect.value
        ? channelSelect.options[channelSelect.selectedIndex].text
        : 'All Channels';
      document.getElementById('filter-channel').classList.toggle('is-active', !!filterChannel);
      reload();
    });

    // Unread
    document.getElementById('filter-unread').addEventListener('click', function() {
      filterUnread = !filterUnread;
      this.classList.toggle('is-active', filterUnread);
      this.setAttribute('aria-pressed', filterUnread);
      applyFilters();
      render();
    });

    // Search
    let searchTimeout;
    document.getElementById('search-input').addEventListener('input', function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchQuery = this.value.trim();
        reload();
      }, 300);
    });
  }

  async function reload() {
    skeleton.style.display = '';
    clearFeed();
    await loadPage(1);
  }

  function clearFeed() {
    const dayGroups = feed.querySelectorAll('.day-group');
    dayGroups.forEach(g => g.remove());
  }

  function populateChannelFilter() {
    const select = document.getElementById('filter-channel-select');
    // Remove all but first option
    while (select.options.length > 1) select.remove(1);
    channels.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch.channelName;
      opt.textContent = ch.channelName;
      select.appendChild(opt);
    });

    // Also populate the channel selector dropdown
    populateChannelSelect();
  }

  function populateChannelSelect() {
    const select = document.getElementById('channel-select');
    if (!select) return;

    // Remove all but first option
    while (select.options.length > 1) select.remove(1);

    // Update count in first option
    select.options[0].textContent = `All Channels (${channels.length})`;

    // Sort channels alphabetically
    const sorted = [...channels].sort((a, b) =>
      a.channelName.localeCompare(b.channelName)
    );

    sorted.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch.channelName;
      opt.textContent = ch.channelName;
      select.appendChild(opt);
    });

    // Bind change event (only once)
    if (!select._bound) {
      select._bound = true;
      select.addEventListener('change', () => {
        filterChannel = select.value;

        // Sync with the filter pill dropdown
        const channelFilterSelect = document.getElementById('filter-channel-select');
        const channelLabel = document.getElementById('filter-channel-label');
        channelFilterSelect.value = select.value;
        channelLabel.textContent = select.value || 'All Channels';
        document.getElementById('filter-channel').classList.toggle('is-active', !!select.value);

        reload();
      });
    }
  }

  function bindLoadMore() {
    loadMoreBtn.addEventListener('click', async () => {
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = 'Loading...';
      await loadPage(currentPage + 1);
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = 'Load more days';
    });
  }

  // --- Rendering ---

  function render() {
    skeleton.style.display = 'none';

    clearFeed();

    if (filteredSummaries.length === 0) {
      emptyState.style.display = '';
      loadMoreWrap.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';

    // Group by day (processedAt date)
    const groups = groupByDay(filteredSummaries);
    const today = new Date().toISOString().split('T')[0];

    groups.forEach((summaries, dateStr) => {
      const group = createDayGroup(dateStr, summaries, dateStr === today);
      feed.appendChild(group);
    });

    loadMoreWrap.style.display = hasMore ? '' : 'none';
  }

  function groupByDay(summaries) {
    const groups = new Map();
    summaries.forEach(s => {
      const day = (s.processedAt || s.publishedDate || '').split('T')[0];
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(s);
    });
    // Sort within each day: newest first
    groups.forEach((items) => {
      items.sort((a, b) => {
        const ta = a.processedAt || a.publishedDate || '';
        const tb = b.processedAt || b.publishedDate || '';
        return tb.localeCompare(ta);
      });
    });
    return groups;
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (dateStr === todayStr) return 'Today';
    if (dateStr === yesterdayStr) return 'Yesterday';

    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function createDayGroup(dateStr, summaries, expanded) {
    const group = document.createElement('div');
    group.className = 'day-group' + (expanded ? ' is-expanded' : '');

    const header = document.createElement('div');
    header.className = 'day-header';
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', expanded);
    header.setAttribute('tabindex', '0');
    header.innerHTML = `
      <span class="day-header__chevron">&#9654;</span>
      <span class="day-header__date">${formatDate(dateStr)}</span>
      <span class="day-header__line"></span>
      <span class="day-header__count">${summaries.length} video${summaries.length !== 1 ? 's' : ''}</span>
    `;

    header.addEventListener('click', () => {
      const isExpanded = group.classList.toggle('is-expanded');
      header.setAttribute('aria-expanded', isExpanded);
    });

    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        header.click();
      }
    });

    const body = document.createElement('div');
    body.className = 'day-body';

    summaries.forEach(s => {
      const card = createVideoCard(s);
      body.appendChild(card);
    });

    group.appendChild(header);
    group.appendChild(body);
    return group;
  }

  function createVideoCard(summary) {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.dataset.videoId = summary.videoId;

    if (DigestState.isRead(summary.videoId)) {
      card.classList.add('is-read');
    }

    const inner = renderCardInner(summary, false);
    card.appendChild(inner);

    return card;
  }

  /**
   * Render card contents. Used by both feed cards and ad-hoc results.
   * @param {Object} summary - summary index or full summary
   * @param {boolean} startExpanded - for ad-hoc results
   */
  function renderCardInner(summary, startExpanded) {
    const frag = document.createDocumentFragment();
    const s = summary.summary || summary;
    const videoId = summary.videoId;
    // Collapsed section
    const collapsed = document.createElement('div');
    collapsed.className = 'video-card__collapsed';

    const publishedMT = formatMountainTime(summary.publishedDate);

    collapsed.innerHTML = `
      <div class="video-card__meta">
        <span class="video-card__channel">${escapeHtml(summary.channelName || '')}</span>
      </div>
      <div class="video-card__title">${escapeHtml(summary.title || '')}</div>
      ${publishedMT ? `<div class="video-card__published">${publishedMT}</div>` : ''}
    `;

    // Timeline bar
    const keyMoments = s.keyMoments || [];
    const duration = summary.estimatedDurationSeconds || 0;
    const timeline = Timeline.render(keyMoments, duration, videoId);
    collapsed.appendChild(timeline);

    // TLDR
    const tldr = document.createElement('div');
    tldr.className = 'video-card__tldr';
    tldr.textContent = s.tldr || summary.tldr || '';
    collapsed.appendChild(tldr);

    // Chevron
    const chevron = document.createElement('div');
    chevron.className = 'video-card__chevron';
    chevron.innerHTML = '&#9660;';
    collapsed.appendChild(chevron);

    collapsed.addEventListener('click', async (e) => {
      // Don't toggle if clicking a link inside timeline
      if (e.target.closest('.timeline-bar__moment')) return;

      const card = collapsed.closest('.video-card, .adhoc-result');
      const isExpanded = card.classList.toggle('is-expanded');

      if (isExpanded && !card.querySelector('.video-card__expanded')) {
        // Lazy load full details
        let full = summary;
        if (!summary.summary?.keyPoints) {
          try {
            full = await fetchFullSummary(videoId);
          } catch { return; }
        }
        const expanded = renderExpandedSection(full);
        card.appendChild(expanded);
      }
    });

    frag.appendChild(collapsed);

    // If startExpanded (ad-hoc), render expanded immediately
    if (startExpanded && summary.summary) {
      const expanded = renderExpandedSection(summary);
      frag.appendChild(expanded);
      // Need to mark parent as expanded after append
      requestAnimationFrame(() => {
        const card = collapsed.closest('.video-card, .adhoc-result');
        if (card) card.classList.add('is-expanded');
      });
    }

    return frag;
  }

  function renderExpandedSection(full) {
    const s = full.summary || full;
    const videoId = full.videoId;
    const expanded = document.createElement('div');
    expanded.className = 'video-card__expanded fade-in';

    let html = '';

    // Topic Timestamps at the top (clickable jump-to links)
    if (s.keyMoments && s.keyMoments.length) {
      html += `<div class="topic-timestamps">
        <div class="topic-timestamps__label">Topics</div>
        <ul class="topic-timestamps__list">
          ${s.keyMoments.map(m =>
            `<li class="topic-timestamps__item"><a class="ts-link" href="https://youtube.com/watch?v=${videoId}&t=${m.seconds}" target="_blank" rel="noopener">${escapeHtml(m.timestamp)}</a> ${escapeHtml(m.label)}</li>`
          ).join('')}
        </ul>
      </div>`;
    }

    // Key Points
    if (s.keyPoints && s.keyPoints.length) {
      html += `<div class="summary-section">
        <div class="summary-section__label">Key Points</div>
        <ul class="summary-section__list">
          ${s.keyPoints.map(p => `<li>${linkifyTimestamps(escapeHtml(p), videoId)}</li>`).join('')}
        </ul>
      </div>`;
    }

    // Notable Details
    if (s.notableDetails) {
      html += `<div class="summary-section">
        <div class="summary-section__label">Notable Details</div>
        <div class="summary-section__content">${linkifyTimestamps(escapeHtml(s.notableDetails), videoId)}</div>
      </div>`;
    }

    // Why This Matters
    if (s.whyThisMatters) {
      html += `<div class="summary-section">
        <div class="summary-section__label">Why This Matters</div>
        <div class="summary-section__content">${linkifyTimestamps(escapeHtml(s.whyThisMatters), videoId)}</div>
      </div>`;
    }


    // Actions
    const isRead = DigestState.isRead(videoId);

    html += `<div class="card-actions">
      <a class="card-action card-action--primary" href="https://youtube.com/watch?v=${videoId}" target="_blank" rel="noopener">
        &#9654; Watch Video
      </a>
      ${TTS.supported ? `<button class="card-action card-action--listen" data-video-id="${videoId}">
        &#128266; Listen
      </button>` : ''}
      <button class="card-action card-action--read ${isRead ? 'is-read' : ''}" data-video-id="${videoId}">
        ${isRead ? '\u2714 Read' : '\u2714 Mark Read'}
      </button>
    </div>`;

    // TTS controls (hidden until Listen is clicked)
    if (TTS.supported) {
      html += `<div class="tts-controls" data-video-id="${videoId}" style="display:none">
        <button class="tts-speed is-active" data-rate="1">1x</button>
        <button class="tts-speed" data-rate="1.5">1.5x</button>
        <button class="tts-speed" data-rate="2">2x</button>
        <button class="tts-stop">Stop</button>
      </div>`;
    }

    expanded.innerHTML = html;

    // Bind action events
    bindCardActions(expanded, full);

    return expanded;
  }

  function bindCardActions(container, full) {
    const videoId = full.videoId;
    const s = full.summary || full;

    // Mark Read
    const readBtn = container.querySelector('.card-action--read');
    if (readBtn) {
      readBtn.addEventListener('click', () => {
        const nowRead = DigestState.toggleRead(videoId);
        readBtn.classList.toggle('is-read', nowRead);
        readBtn.innerHTML = nowRead ? '\u2714 Read' : '\u2714 Mark Read';
        const card = container.closest('.video-card');
        if (card) card.classList.toggle('is-read', nowRead);
        updateStats();
        if (filterUnread) { applyFilters(); render(); }
      });
    }

    // Listen
    const listenBtn = container.querySelector('.card-action--listen');
    const ttsControls = container.querySelector('.tts-controls');
    if (listenBtn && ttsControls) {
      listenBtn.addEventListener('click', () => {
        const text = TTS.buildText(s);
        TTS.speak(text, 1);
        ttsControls.style.display = '';
        listenBtn.innerHTML = '&#10074;&#10074; Pause';

        TTS.onStateChange = () => {
          if (!TTS.isPlaying && !TTS.isPaused) {
            listenBtn.innerHTML = '&#128266; Listen';
            ttsControls.style.display = 'none';
          }
        };

        // Toggle pause/resume on re-click
        listenBtn.removeEventListener('click', listenBtn._pauseHandler);
        listenBtn._pauseHandler = () => {
          if (TTS.isPaused) {
            TTS.resume();
            listenBtn.innerHTML = '&#10074;&#10074; Pause';
          } else if (TTS.isPlaying) {
            TTS.pause();
            listenBtn.innerHTML = '&#128266; Resume';
          } else {
            TTS.speak(text, TTS.rate);
            listenBtn.innerHTML = '&#10074;&#10074; Pause';
            ttsControls.style.display = '';
          }
        };
      });

      // Speed buttons
      ttsControls.querySelectorAll('.tts-speed').forEach(btn => {
        btn.addEventListener('click', () => {
          const rate = parseFloat(btn.dataset.rate);
          ttsControls.querySelectorAll('.tts-speed').forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          // Restart with new rate
          const text = TTS.buildText(s);
          TTS.speak(text, rate);
          if (listenBtn) listenBtn.innerHTML = '&#10074;&#10074; Pause';
        });
      });

      // Stop button
      const stopBtn = ttsControls.querySelector('.tts-stop');
      if (stopBtn) {
        stopBtn.classList.add('is-visible');
        stopBtn.addEventListener('click', () => {
          TTS.stop();
          ttsControls.style.display = 'none';
          listenBtn.innerHTML = '&#128266; Listen';
        });
      }
    }
  }

  // --- Stats ---

  function updateStats() {
    const today = new Date().toISOString().split('T')[0];
    const todaySummaries = allSummaries.filter(s =>
      (s.processedAt || '').split('T')[0] === today
    );
    const readSet = DigestState.getReadSet();
    const unreadCount = allSummaries.filter(s => !readSet.has(s.videoId)).length;
    const readMinutes = Math.ceil((allSummaries.length * 500) / 250); // ~500 words per summary, 250 wpm

    statsNew.textContent = `${todaySummaries.length} new today`;
    statsReadTime.textContent = `~${readMinutes} min read`;
    statsUnread.textContent = `${unreadCount} unread`;
  }

  // --- Utilities ---

  function escapeHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatMountainTime(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('en-US', {
        timeZone: 'America/Denver',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }) + ' MT';
    } catch {
      return '';
    }
  }

  function linkifyTimestamps(html, videoId) {
    return html.replace(
      /\[(\d{1,2}:\d{2})\]/g,
      (_, ts) => {
        const parts = ts.split(':');
        const seconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        return `<a class="ts-link" href="https://youtube.com/watch?v=${videoId}&t=${seconds}" target="_blank" rel="noopener">${ts}</a>`;
      }
    );
  }

  // --- Boot ---
  document.addEventListener('DOMContentLoaded', init);

  return { renderCardInner };
})();
