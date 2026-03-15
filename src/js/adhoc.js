/**
 * Ad-hoc URL summarization handler.
 */
const AdHoc = (() => {
  const form = document.getElementById('adhoc-form');
  const input = document.getElementById('adhoc-input');
  const btn = document.getElementById('adhoc-btn');
  const statusEl = document.getElementById('adhoc-status');
  const statusText = document.getElementById('adhoc-status-text');
  const resultsContainer = document.getElementById('adhoc-results');

  function showStatus(msg, isError) {
    statusEl.classList.add('is-visible');
    statusEl.classList.toggle('is-error', !!isError);
    if (isError) {
      statusEl.innerHTML = `<span id="adhoc-status-text">${msg}</span>`;
    } else {
      statusEl.innerHTML = `<div class="adhoc__spinner"></div><span id="adhoc-status-text">${msg}</span>`;
    }
  }

  function hideStatus() {
    statusEl.classList.remove('is-visible', 'is-error');
  }

  function setLoading(loading) {
    btn.disabled = loading;
    input.disabled = loading;
    btn.textContent = loading ? '...' : 'Go';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) return;

    // Basic URL validation
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      showStatus('Please enter a valid YouTube URL.', true);
      return;
    }

    hideStatus();
    setLoading(true);
    showStatus('Pulling transcript and generating summary...');

    try {
      const res = await fetch('/api/summarize-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!data.success) {
        showStatus(data.error || 'Something went wrong.', true);
        setLoading(false);
        return;
      }

      hideStatus();
      setLoading(false);
      input.value = '';

      // Render ad-hoc result
      renderAdHocResult(data.summary);
    } catch (err) {
      showStatus('Network error. Please try again.', true);
      setLoading(false);
    }
  }

  function renderAdHocResult(summary) {
    const card = document.createElement('div');
    card.className = 'adhoc-result fade-in';

    const label = document.createElement('div');
    label.className = 'adhoc-result__label';
    label.innerHTML = `
      <span>Ad-hoc summary</span>
      <button class="adhoc-result__dismiss" aria-label="Dismiss">Dismiss</button>
    `;
    label.querySelector('.adhoc-result__dismiss').addEventListener('click', () => {
      card.remove();
    });
    card.appendChild(label);

    // Reuse the app's card rendering if available
    if (typeof DigestApp !== 'undefined' && DigestApp.renderCardInner) {
      const inner = DigestApp.renderCardInner(summary, true);
      card.appendChild(inner);
    } else {
      // Fallback minimal render
      const content = document.createElement('div');
      content.style.padding = '16px';
      content.innerHTML = `
        <div style="font-weight:600;margin-bottom:8px">${escapeHtml(summary.title)}</div>
        <div>${escapeHtml(summary.summary?.tldr || '')}</div>
      `;
      card.appendChild(content);
    }

    resultsContainer.prepend(card);
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  if (form) {
    form.addEventListener('submit', handleSubmit);
  }

  return { renderAdHocResult };
})();
