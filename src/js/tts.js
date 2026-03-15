/**
 * Text-to-Speech abstraction layer.
 * v1: BrowserTTSProvider using Web Speech API.
 * Future: ElevenLabsTTSProvider can be swapped in.
 */
const TTS = (() => {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  let currentUtterance = null;
  let currentRate = 1;
  let isPlaying = false;
  let isPaused = false;
  let preferredVoice = null;

  // Find a good English voice
  function loadVoice() {
    if (!supported) return;
    const voices = speechSynthesis.getVoices();
    const preferred = [
      'Google US English',
      'Samantha',
      'Alex',
      'Daniel',
      'Karen',
    ];
    for (const name of preferred) {
      const found = voices.find(v => v.name.includes(name) && v.lang.startsWith('en'));
      if (found) { preferredVoice = found; return; }
    }
    // Fallback to any English voice
    preferredVoice = voices.find(v => v.lang.startsWith('en')) || null;
  }

  if (supported) {
    speechSynthesis.addEventListener('voiceschanged', loadVoice);
    loadVoice();
  }

  /**
   * Build speakable text from a summary, stripping timestamps.
   */
  function buildText(summary) {
    const parts = [];
    if (summary.tldr) parts.push(summary.tldr);
    if (summary.keyPoints && summary.keyPoints.length) {
      parts.push('Key Points.');
      summary.keyPoints.forEach(p => parts.push(p));
    }
    if (summary.notableDetails) {
      parts.push('Notable Details. ' + summary.notableDetails);
    }
    if (summary.whyThisMatters) {
      parts.push('Why This Matters. ' + summary.whyThisMatters);
    }
    // Strip [MM:SS] timestamps
    return parts.join('. ').replace(/\[\d{1,2}:\d{2}\]/g, '');
  }

  function speak(text, rate) {
    if (!supported) return;
    stop();
    currentRate = rate || 1;
    currentUtterance = new SpeechSynthesisUtterance(text);
    currentUtterance.rate = currentRate;
    if (preferredVoice) currentUtterance.voice = preferredVoice;
    currentUtterance.onend = () => {
      isPlaying = false;
      isPaused = false;
      if (typeof TTS.onStateChange === 'function') TTS.onStateChange();
    };
    speechSynthesis.speak(currentUtterance);
    isPlaying = true;
    isPaused = false;
  }

  function pause() {
    if (!supported || !isPlaying) return;
    speechSynthesis.pause();
    isPaused = true;
    if (typeof TTS.onStateChange === 'function') TTS.onStateChange();
  }

  function resume() {
    if (!supported || !isPaused) return;
    speechSynthesis.resume();
    isPaused = false;
    if (typeof TTS.onStateChange === 'function') TTS.onStateChange();
  }

  function stop() {
    if (!supported) return;
    speechSynthesis.cancel();
    isPlaying = false;
    isPaused = false;
    currentUtterance = null;
    if (typeof TTS.onStateChange === 'function') TTS.onStateChange();
  }

  return {
    supported,
    speak,
    pause,
    resume,
    stop,
    buildText,
    get isPlaying() { return isPlaying; },
    get isPaused() { return isPaused; },
    get rate() { return currentRate; },
    onStateChange: null,
  };
})();
