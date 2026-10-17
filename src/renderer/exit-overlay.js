'use strict';

// Receives { name, progress } from the main process and mirrors it into the glass panel.
const ring = document.querySelector('#ring');
const title = document.querySelector('#title');

window.exitOverlay?.onState(({ name, progress }) => {
  title.textContent = `Close ${name || 'application'}?`;
  ring.style.setProperty('--progress', String(Math.round(Math.max(0, Math.min(1, progress)) * 100)));
});
