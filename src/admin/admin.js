/**
 * Admin panel logic for YouTube AI Digest.
 */
(async function() {

  // --- Status ---
  async function loadStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();

      setText('stat-last-check', data.lastCheck
        ? new Date(data.lastCheck).toLocaleString()
        : 'Never');
      setText('stat-channels', data.totalChannels);
      setText('stat-today', data.videosToday);
      setText('stat-total', data.totalVideosProcessed);
      setText('stat-cost', '$' + data.monthlyCost.toFixed(2));
      setText('stat-avg', '$' + data.avgCostPerVideo.toFixed(4));
      setText('stat-projected', '$' + data.projectedMonthlyCost.toFixed(2));
      setText('stat-adhoc', '$' + data.monthlyAdHocCost.toFixed(2));
    } catch {
      setText('stat-last-check', 'Error');
    }
  }

  // --- Channels ---
  let channels = [];

  async function loadChannels() {
    try {
      const res = await fetch('/api/channels');
      channels = await res.json();
      renderChannels();
    } catch {
      document.getElementById('channels-tbody').innerHTML =
        '<tr><td colspan="4" style="color:var(--red);text-align:center;padding:20px">Failed to load channels</td></tr>';
    }
  }

  function renderChannels() {
    const tbody = document.getElementById('channels-tbody');
    if (channels.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted);text-align:center;padding:20px">No channels added yet</td></tr>';
      return;
    }

    tbody.innerHTML = channels.map(ch => `
      <tr>
        <td style="font-weight:500">${escapeHtml(ch.channelName)}</td>
        <td><a href="${escapeHtml(ch.handleUrl)}" target="_blank" rel="noopener" style="font-size:0.8125rem">${escapeHtml(ch.handleUrl)}</a></td>
        <td style="font-size:0.8125rem;color:var(--text-muted)">${new Date(ch.addedAt).toLocaleDateString()}</td>
        <td><button class="admin-remove-btn" data-id="${escapeHtml(ch.channelId)}">Remove</button></td>
      </tr>
    `).join('');

    // Bind remove buttons
    tbody.querySelectorAll('.admin-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const name = channels.find(c => c.channelId === id)?.channelName || 'this channel';
        if (!confirm(`Remove ${name}?`)) return;

        btn.disabled = true;
        btn.textContent = '...';

        try {
          const res = await fetch(`/api/channels/${id}`, { method: 'DELETE' });
          if (res.ok) {
            await loadChannels();
            await loadStatus();
          } else {
            alert('Failed to remove channel');
          }
        } catch {
          alert('Network error');
        }
        btn.disabled = false;
        btn.textContent = 'Remove';
      });
    });
  }

  // --- Add Channel ---
  const addForm = document.getElementById('add-form');
  const addInput = document.getElementById('add-input');
  const addBtn = document.getElementById('add-btn');
  const addMsg = document.getElementById('add-msg');

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = addInput.value.trim();
    if (!url) return;

    addBtn.disabled = true;
    addBtn.textContent = 'Adding...';
    addMsg.className = 'admin-msg';
    addMsg.style.display = 'none';

    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();

      if (res.ok) {
        addMsg.className = 'admin-msg admin-msg--success';
        addMsg.textContent = `Added ${data.channelName}`;
        addInput.value = '';
        await loadChannels();
        await loadStatus();
      } else {
        addMsg.className = 'admin-msg admin-msg--error';
        addMsg.textContent = data.error || 'Failed to add channel';
      }
    } catch {
      addMsg.className = 'admin-msg admin-msg--error';
      addMsg.textContent = 'Network error';
    }

    addBtn.disabled = false;
    addBtn.textContent = 'Add';
  });

  // --- Utilities ---
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // --- Init ---
  await Promise.all([loadStatus(), loadChannels()]);

})();
