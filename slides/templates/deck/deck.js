// Deck format v1. No service, build step or network required.
(() => {
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme');
  const themeLink = document.getElementById('theme');
  const bundled = document.getElementById('deck-themes');
  if (themeLink && theme && /^[a-z0-9-]{1,40}$/.test(theme)) {
    try {
      if (bundled) {
        const themes = JSON.parse(bundled.textContent);
        if (Object.hasOwn(themes, theme) && typeof themes[theme] === 'string') themeLink.href = themes[theme];
      } else themeLink.href = new URL(`themes/${theme}.css`, location.href).href;
    } catch { /* Keep the default theme if metadata or the base URL is unusable. */ }
  }
  const a4 = document.querySelector('meta[name="deck:size"]')?.content === 'a4';
  const [width, height] = a4 ? [794, 1123] : [1280, 720];
  document.documentElement.style.setProperty('--slide-w', `${width}px`);
  document.documentElement.style.setProperty('--slide-h', `${height}px`);
  document.documentElement.dataset.size = a4 ? 'a4' : '16:9';
  document.documentElement.classList.toggle('printing', params.has('print'));
  const pageStyle = document.createElement('style');
  pageStyle.textContent = `@page { size: ${width}px ${height}px; margin: 0; }`;
  document.head.append(pageStyle);
  const slides = [...document.querySelectorAll('main.deck > section.slide')];
  const title = document.querySelector('meta[name="deck:title"]')?.content || document.title;
  slides.forEach((slide, i) => {
    if (!slide.id) slide.id = `slide-${i + 1}`;
    slide.dataset.foot = title;
    const pn = document.createElement('div'); pn.className = 'pn'; pn.textContent = `${i + 1} / ${slides.length}`;
    const mark = document.createElement('div'); mark.className = 'mark';
    slide.append(pn, mark);
  });
  let current = 0;
  const show = (index) => {
    if (!slides.length) return;
    current = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach((slide, i) => slide.classList.toggle('on', i === current));
    if (parent !== window) parent.postMessage({ source: 'commando-deck', type: 'slide', id: slides[current].id, index: current, count: slides.length }, '*');
  };
  const select = (hash) => {
    let id; try { id = decodeURIComponent(hash); } catch { id = hash; }
    const exact = slides.findIndex(slide => slide.id === id);
    return exact >= 0 ? exact : /^\d+$/.test(id) ? Number(id) - 1 : 0;
  };
  const go = (index) => {
    if (!slides.length || !Number.isInteger(index)) return;
    show(index);
    const hash = `#${slides[current].id}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  };
  const fit = () => {
    const scale = Math.min(innerWidth / width, innerHeight / height);
    slides.forEach(slide => { slide.style.transform = `scale(${scale})`; });
  };
  addEventListener('hashchange', () => show(select(location.hash.slice(1))));
  addEventListener('resize', fit);
  addEventListener('keydown', event => {
    if (params.has('thumb') || event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    const offsets = { ArrowRight: 1, ' ': 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 };
    if (event.key in offsets) { event.preventDefault(); go(current + offsets[event.key]); }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); go(event.key === 'Home' ? 0 : slides.length - 1); }
  });
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.source !== 'commando-deck' || event.data.type !== 'go') return;
    if (typeof event.data.id === 'string') {
      const index = slides.findIndex(slide => slide.id === event.data.id);
      if (index >= 0) go(index);
    } else if (Number.isInteger(event.data.index)) go(event.data.index);
  });
  fit(); show(select(location.hash.slice(1)));
})();
