(function (root, factory) {
  'use strict';
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.MouseModeModel = model;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  function wheelToHorizontal({ deltaX, deltaY } = {}) {
    return deltaX || deltaY || 0;
  }

  function clickAction(element) {
    if (!element) return null;
    const tagName = String(element.tagName || element.nodeName || '').toUpperCase();
    if (tagName === 'BUTTON' || element.classList?.contains('pointer-target')) return 'activate';
    return null;
  }

  return { wheelToHorizontal, clickAction };
});
