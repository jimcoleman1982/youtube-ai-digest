/**
 * Key Moments timeline bar rendering.
 */
const Timeline = (() => {

  /**
   * Create a timeline bar element.
   * @param {Array} keyMoments - [{timestamp, seconds, label}]
   * @param {number} durationSeconds - total video duration
   * @param {string} videoId - for building YouTube links
   * @returns {HTMLElement}
   */
  function render(keyMoments, durationSeconds, videoId) {
    const bar = document.createElement('div');
    bar.className = 'timeline-bar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Key moments in video');

    const track = document.createElement('div');
    track.className = 'timeline-bar__track';

    if (!keyMoments || keyMoments.length === 0 || !durationSeconds) {
      bar.appendChild(track);
      return bar;
    }

    keyMoments.forEach(moment => {
      const pct = Math.min((moment.seconds / durationSeconds) * 100, 100);

      const dot = document.createElement('a');
      dot.className = 'timeline-bar__moment';
      dot.style.left = pct + '%';
      dot.href = `https://youtube.com/watch?v=${videoId}&t=${moment.seconds}`;
      dot.target = '_blank';
      dot.rel = 'noopener';
      dot.setAttribute('aria-label', `${moment.label} at ${moment.timestamp}`);

      const tooltip = document.createElement('span');
      tooltip.className = 'timeline-bar__tooltip';
      tooltip.textContent = `${moment.timestamp} ${moment.label}`;
      dot.appendChild(tooltip);

      track.appendChild(dot);
    });

    bar.appendChild(track);
    return bar;
  }

  return { render };
})();
