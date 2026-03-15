/**
 * State management via localStorage for star/read per video.
 */
const DigestState = (() => {
  const STARRED_KEY = 'yt-digest-starred';
  const READ_KEY = 'yt-digest-read';

  function getSet(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? new Set(JSON.parse(data)) : new Set();
    } catch {
      return new Set();
    }
  }

  function saveSet(key, set) {
    localStorage.setItem(key, JSON.stringify([...set]));
  }

  return {
    isStarred(videoId) {
      return getSet(STARRED_KEY).has(videoId);
    },

    toggleStar(videoId) {
      const set = getSet(STARRED_KEY);
      if (set.has(videoId)) {
        set.delete(videoId);
      } else {
        set.add(videoId);
      }
      saveSet(STARRED_KEY, set);
      return set.has(videoId);
    },

    isRead(videoId) {
      return getSet(READ_KEY).has(videoId);
    },

    toggleRead(videoId) {
      const set = getSet(READ_KEY);
      if (set.has(videoId)) {
        set.delete(videoId);
      } else {
        set.add(videoId);
      }
      saveSet(READ_KEY, set);
      return set.has(videoId);
    },

    getStarredSet() {
      return getSet(STARRED_KEY);
    },

    getReadSet() {
      return getSet(READ_KEY);
    }
  };
})();
