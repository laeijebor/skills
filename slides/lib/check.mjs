// Runs inside Chromium. Geometry and contrast checks are deliberately approximate.
export function inspectSlide(index, minimumText) {
  const slide = document.querySelectorAll('main.deck > section.slide')[index];
  const bounds = slide.getBoundingClientRect();
  const issues = [];
  const selector = element => {
    const parts = [];
    while (element && element !== document.body) {
      const siblings = element.parentElement ? [...element.parentElement.children].filter(node => node.tagName === element.tagName) : [];
      parts.unshift(`${element.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(element) + 1})`);
      element = element.parentElement;
    }
    return `body > ${parts.join(' > ')}`;
  };
  const add = (kind, message, element, level = 'error') => issues.push({ level, kind, message, selector: selector(element) });
  const rgba = color => {
    const values = color.match(/[\d.]+/g)?.map(Number);
    return values?.length >= 3 ? [...values.slice(0, 3), values[3] ?? 1] : null;
  };
  const luminance = color => color.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  const background = element => {
    const box = element.getBoundingClientRect();
    const centre = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    for (let node = element; node; node = node.parentElement) {
      const ancestor = node.getBoundingClientRect();
      // Chart labels may sit beside their bar rather than over its background.
      if (centre.x < ancestor.left || centre.x > ancestor.right || centre.y < ancestor.top || centre.y > ancestor.bottom) continue;
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none') return null;
      const color = rgba(style.backgroundColor);
      if (color && color[3] >= .99) return color;
      if (color && color[3] > 0) return null;
    }
    return null;
  };
  for (const element of [slide, ...slide.querySelectorAll('*')]) {
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    if (!box.width || !box.height || style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0 || element.closest('.notes,.ask,[hidden]')) continue;
    if (element !== slide && (box.left < bounds.left - 1 || box.top < bounds.top - 1 || box.right > bounds.right + 1 || box.bottom > bounds.bottom + 1)) add('bounds', 'Element extends outside the slide', element);
    const clippedX = ['hidden', 'clip'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
    const clippedY = ['hidden', 'clip'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
    if (clippedX || clippedY) add('clipping', `Clipped overflow (${element.scrollWidth}×${element.scrollHeight} inside ${element.clientWidth}×${element.clientHeight})`, element);
    if (element.tagName === 'IMG' && (!element.complete || !element.naturalWidth)) add('image', `Image did not load: ${element.getAttribute('src')}`, element);
    const hasText = [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (!hasText || ['SCRIPT', 'STYLE'].includes(element.tagName)) continue;
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const clipping = getComputedStyle(ancestor), frame = ancestor.getBoundingClientRect();
      const outsideX = ['hidden', 'clip'].includes(clipping.overflowX) && (box.left < frame.left - 1 || box.right > frame.right + 1);
      const outsideY = ['hidden', 'clip'].includes(clipping.overflowY) && (box.top < frame.top - 1 || box.bottom > frame.bottom + 1);
      if (outsideX || outsideY) {
        add('clipping', `Text extends beyond a clipping ancestor (${selector(ancestor)})`, element);
        break;
      }
      if (ancestor === slide) break;
    }
    const size = parseFloat(style.fontSize);
    if (size < minimumText) add('text-size', `Visible text is ${size}px; minimum is ${minimumText}px`, element);
    const bg = background(element), fg = rgba(style.color);
    if (bg && fg && fg[3] >= .99 && Number(style.opacity) === 1) {
      const a = luminance(fg), b = luminance(bg), contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      if (contrast < 4.5) add('contrast', `Text contrast is ${contrast.toFixed(2)}:1; minimum is 4.5:1`, element);
    }
  }
  return issues;
}
