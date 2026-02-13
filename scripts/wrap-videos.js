(() => {
  const DEFAULT_ACCOUNT_BASE = 'https://customer-3ptq6xbmg2sfpv29.cloudflarestream.com';
  const POSTER_PARAMS = '?time=1s&height=600';

  const getAccountBase = () => {
    const declared = document.body?.dataset.cloudflareAccount || document.documentElement?.dataset.cloudflareAccount;
    return (declared || DEFAULT_ACCOUNT_BASE).replace(/\/+$/, '');
  };

  const ready = callback => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  };

  const buildStreamUrl = (id, type) => {
    if (!id) return '';
    const base = getAccountBase();
    if (type === 'poster') {
      return `${base}/${id}/thumbnails/thumbnail.jpg${POSTER_PARAMS}`;
    }
    if (type === 'dash') {
      return `${base}/${id}/manifest/video.mpd`;
    }
    return `${base}/${id}/manifest/video.m3u8`;
  };

  const shouldSkipElement = el => {
    if (!el) return false;
    if (typeof el.closest === 'function' && el.closest('[data-instagram-tile]')) return true;
    if (typeof el.matches === 'function' && el.matches('video[data-hls-src]')) return true;
    return false;
  };

  const getTargetVideos = () =>
    Array.from(document.querySelectorAll('[data-design-video]')).filter(video => !shouldSkipElement(video));
  const getPromptTargets = () => Array.from(document.querySelectorAll('[data-design-video-prompt]'));

  const toggleVideoDisplay = show => {
    getTargetVideos().forEach(video => {
      if (show) {
        video.style.opacity = '';
        video.style.visibility = '';
        video.removeAttribute('aria-hidden');
        return;
      }
      video.pause?.();
      video.removeAttribute('autoplay');
      try {
        video.currentTime = 0;
      } catch (error) {
        /* noop */
      }
      video.style.opacity = '0';
      video.style.visibility = 'hidden';
      video.setAttribute('aria-hidden', 'true');
    });
  };

  const hidePrompt = () => {
    getPromptTargets().forEach(container => {
      container.hidden = true;
      container.setAttribute('aria-hidden', 'true');
    });
    toggleVideoDisplay(true);
  };

  const showPrompt = prompt => {
    const containers = getPromptTargets();
    if (!containers.length) return;
    containers.forEach(container => {
      const titleEl = container.querySelector('[data-prompt-title]');
      if (titleEl && prompt?.title) {
        titleEl.textContent = prompt.title;
      }
      const bodyEl = container.querySelector('[data-prompt-body]');
      if (bodyEl && prompt?.body) {
        bodyEl.textContent = prompt.body;
      }
      const ctaEl = container.querySelector('[data-prompt-cta]');
      if (ctaEl) {
        if (prompt?.ctaLabel) {
          ctaEl.textContent = prompt.ctaLabel;
        }
        if (prompt?.ctaHref) {
          ctaEl.setAttribute('href', prompt.ctaHref);
        }
        ctaEl.toggleAttribute('hidden', !(ctaEl.getAttribute('href') || prompt?.ctaHref));
      }
      container.hidden = false;
      container.removeAttribute('aria-hidden');
    });
    toggleVideoDisplay(false);
  };

  const getPromptConfig = trigger => {
    if (!trigger) return null;
    const title = trigger.dataset.videoPromptTitle;
    const body = trigger.dataset.videoPrompt;
    const ctaLabel = trigger.dataset.videoPromptCtaLabel;
    const ctaHref = trigger.dataset.videoPromptCtaHref;
    if (!title && !body && !ctaLabel && !ctaHref) return null;
    return { title, body, ctaLabel, ctaHref };
  };

  const getVideoConfig = trigger => {
    if (!trigger) return null;
    const prompt = getPromptConfig(trigger);
    if (prompt) {
      return { type: 'prompt', prompt };
    }
    const directSrc = trigger.dataset.videoSrc;
    const videoId = trigger.dataset.videoId;
    if (!directSrc && !videoId) return null;
    return {
      type: 'video',
      video: {
      hls: directSrc || buildStreamUrl(videoId, 'hls'),
      dash: trigger.dataset.videoDash || buildStreamUrl(videoId, 'dash'),
      poster: trigger.dataset.videoPoster || buildStreamUrl(videoId, 'poster')
      }
    };
  };

  const applyVideoConfig = config => {
    if (!config?.hls) return;
    hidePrompt();
    getTargetVideos().forEach(video => {
      if (shouldSkipElement(video)) return;
      const sources = video.querySelectorAll('source[data-source]');
      const primarySource = Array.from(sources).find(src => src.dataset.source === 'hls') || video.querySelector('source');
      const dashSource = Array.from(sources).find(src => src.dataset.source === 'dash');
      if (primarySource) {
        if (primarySource.getAttribute('src') === config.hls) return;
        primarySource.setAttribute('src', config.hls);
        primarySource.setAttribute('type', 'application/x-mpegURL');
      }
      if (dashSource && config.dash) {
        dashSource.setAttribute('src', config.dash);
        dashSource.setAttribute('type', 'application/dash+xml');
      }
      if (config.poster) {
        video.setAttribute('poster', config.poster);
      }
      video.autoplay = true;
      video.setAttribute('autoplay', '');
      video.load();
      const attemptPlayback = () => {
        const playPromise = video.play?.();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise.catch(() => {});
        }
      };
      if (video.readyState >= 2) {
        attemptPlayback();
      } else {
        const onReady = () => {
          video.removeEventListener('loadeddata', onReady);
          attemptPlayback();
        };
        video.addEventListener('loadeddata', onReady);
      }
    });
  };

  let defaultApplied = false;

  const enhanceTrigger = trigger => {
    if (trigger.dataset.wrapInit === 'true') return;
    const config = getVideoConfig(trigger);
    if (!config) return;
    trigger.dataset.wrapInit = 'true';
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('role', 'button');
    trigger.style.cursor = trigger.style.cursor || 'pointer';
    const activate = event => {
      event?.preventDefault();
      if (config.type === 'prompt') {
        showPrompt(config.prompt);
        return;
      }
      applyVideoConfig(config.video);
    };
    trigger.addEventListener('click', activate);
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate(event);
      }
    });
    if (!defaultApplied && trigger.dataset.wrapDefault === 'true') {
      defaultApplied = true;
      requestAnimationFrame(() => activate());
    }
  };

  const init = () => {
    document.querySelectorAll('[data-wrap-option]').forEach(enhanceTrigger);
  };

  ready(init);
})();
