(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpatialGrid = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_BUFFER = 1;

  /**
   * @typedef {[row: number, col: number]} SpatialCoordinate
   * @typedef {{ id: string, title: string, items: Array<{ id: string }> }} GridRow
   */

  /**
   * Compute the visible item interval from the scroll offset and uniform tile pitch.
   * The end index is exclusive. Padding shifts item origins inside each track.
   */
  function visibleRangeInto(result, scrollOffset, viewportSize, itemSize, gap, itemCount, paddingStart = 0, buffer = DEFAULT_BUFFER) {
    if (itemCount <= 0 || itemSize <= 0 || viewportSize <= 0) {
      result.start = 0;
      result.end = 0;
      return;
    }
    const pitch = itemSize + gap;
    result.start = Math.max(0, Math.floor((scrollOffset - paddingStart) / pitch) - buffer);
    result.end = Math.max(result.start, Math.min(itemCount, Math.ceil((scrollOffset + viewportSize - paddingStart) / pitch) + buffer));
  }

  /** Allocation-friendly test and consumer wrapper around the render-loop calculation. */
  function visibleRange(scrollOffset, viewportSize, itemSize, gap, itemCount, paddingStart = 0, buffer = DEFAULT_BUFFER) {
    const result = { start: 0, end: 0 };
    visibleRangeInto(result, scrollOffset, viewportSize, itemSize, gap, itemCount, paddingStart, buffer);
    return result;
  }

  /** Return clamped scroll offset that centres one tile in its viewport. */
  function centredScrollOffset(index, itemSize, gap, viewportSize, itemCount, paddingStart = 0, paddingEnd = paddingStart) {
    if (itemCount <= 0 || itemSize <= 0 || viewportSize <= 0) return 0;
    const pitch = itemSize + gap;
    const contentSize = paddingStart + itemCount * itemSize + Math.max(0, itemCount - 1) * gap + paddingEnd;
    const requested = paddingStart + index * pitch + itemSize / 2 - viewportSize / 2;
    return Math.max(0, Math.min(requested, contentSize - viewportSize));
  }

  /** Preserve horizontal intent when an adjacent row has fewer items. */
  function verticalColumn(preferredColumn, itemCount) {
    return itemCount > 0 ? Math.min(Math.max(0, preferredColumn), itemCount - 1) : -1;
  }

  /** Resolve one D-pad move against row lengths. Null means caller may handle a boundary. */
  function nextCoordinate(rows, coordinate, preferredColumn, direction) {
    const [row, col] = coordinate;
    if (direction === 'left' || direction === 'right') {
      const nextCol = col + (direction === 'right' ? 1 : -1);
      return nextCol >= 0 && nextCol < rows[row].items.length ? [row, nextCol] : null;
    }
    const nextRow = row + (direction === 'down' ? 1 : -1);
    if (nextRow < 0 || nextRow >= rows.length) return null;
    const nextCol = verticalColumn(preferredColumn, rows[nextRow].items.length);
    return nextCol < 0 ? null : [nextRow, nextCol];
  }

  class SpatialGrid {
    /**
     * @param {{
     *   viewport: HTMLElement, container: HTMLElement,
     *   createItem: () => HTMLElement,
     *   updateItem: (element: HTMLElement, item: any, rowId: string, col: number) => void,
     *   onFocus?: (element: HTMLElement, item: any, coordinate: SpatialCoordinate) => void,
     *   onItemApproachingViewport?: (item: any, rowId: string, col: number) => void,
     *   decorateHeading?: (head: HTMLElement, row: GridRow) => void,
     *   buffer?: number
     * }} options
     */
    constructor({ viewport, container, createItem, updateItem, onFocus = () => {}, onItemApproachingViewport = () => {}, decorateHeading = () => {}, buffer = DEFAULT_BUFFER }) {
      this.viewport = viewport;
      this.container = container;
      this.createItem = createItem;
      this.updateItem = updateItem;
      this.onFocus = onFocus;
      this.onItemApproachingViewport = onItemApproachingViewport;
      this.decorateHeading = decorateHeading;
      this.buffer = buffer;
      /** @type {GridRow[]} */
      this.rows = [];
      /** @type {Array<Record<string, any>>} */
      this.layouts = [];
      /** @type {SpatialCoordinate | null} */
      this.coordinate = null;
      this.preferredColumn = 0;
      this.itemsByRow = new Map();
      this.prefetched = new Set();
      this.focusedElement = null;
      this.isFocusing = false;
      this.frame = 0;
      this.boundSchedule = () => this.scheduleRender();
      this.boundResize = () => {
        this.measureRows();
        this.scheduleRender();
      };
      this.boundRender = () => {
        this.frame = 0;
        this.renderVisible();
      };
      this.resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(this.boundResize)
        : null;
      this.resizeObserver?.observe(viewport);
      if (!this.resizeObserver) window.addEventListener('resize', this.boundResize);
    }

    /** Replace row data and build only the small per-row node pools needed for the viewport. */
    setRows(rows) {
      this.rows = rows;
      this.layouts.length = 0;
      this.itemsByRow.clear();
      this.coordinate = null;
      this.preferredColumn = 0;
      this.focusedElement = null;
      this.container.replaceChildren();
      const currentIds = new Set();

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const data = rows[rowIndex];
        const section = document.createElement('section');
        section.className = 'row';
        section.dataset.row = data.id;
        section.setAttribute('role', 'group');

        const head = document.createElement('div');
        head.className = 'row-head';
        const heading = document.createElement('h2');
        heading.textContent = data.title;
        head.append(heading);
        this.decorateHeading(head, data);
        const track = document.createElement('div');
        track.className = 'track virtual-track';
        track.setAttribute('aria-label', data.title);
        section.setAttribute('aria-label', data.title);
        section.append(head, track);
        this.container.append(section);

        const layout = {
          section, track, pool: [], indices: [], start: -1,
          width: 0, height: 0, gap: 0, paddingStart: 0, paddingEnd: 0,
          range: { start: 0, end: 0 }, scrollListener: this.boundSchedule
        };
        this.layouts.push(layout);
        track.addEventListener('scroll', layout.scrollListener, { passive: true });
        const byId = new Map();
        for (let col = 0; col < data.items.length; col += 1) {
          byId.set(data.items[col].id, col);
          currentIds.add(data.items[col].id);
        }
        this.itemsByRow.set(data.id, byId);
        if (data.items.length) {
          const first = this.createItem();
          this.updateItem(first, data.items[0], data.id, 0);
          layout.pool.push(first);
          layout.indices.push(-1);
        }
      }

      for (const id of this.prefetched) if (!currentIds.has(id)) this.prefetched.delete(id);
      this.measureRows();
      this.renderVisible();
    }

    measureRows() {
      for (let rowIndex = 0; rowIndex < this.rows.length; rowIndex += 1) {
        const row = this.rows[rowIndex];
        const layout = this.layouts[rowIndex];
        const style = getComputedStyle(layout.track);
        const first = layout.pool[0];
        if (first) {
          first.style.visibility = 'hidden';
          layout.track.append(first);
          layout.width = first.getBoundingClientRect().width;
          layout.height = first.getBoundingClientRect().height;
          first.style.visibility = '';
        }
        layout.gap = parseFloat(style.columnGap) || 0;
        layout.paddingStart = parseFloat(style.paddingLeft) || 0;
        layout.paddingEnd = parseFloat(style.paddingRight) || 0;
        if (!layout.width) layout.width = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tile-width')) || 280;
        if (!layout.height) layout.height = layout.width * 9 / 16;
        layout.track.style.height = `${layout.height + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)}px`;
        const sequenceSize = row.items.length * layout.width + Math.max(0, row.items.length - 1) * layout.gap;
        layout.track.style.setProperty('--virtual-content-width', `${sequenceSize}px`);
        layout.track.style.setProperty('--virtual-y', `${parseFloat(style.paddingTop) || 0}px`);
      }
    }

    scheduleRender() {
      if (this.frame) return;
      this.frame = requestAnimationFrame(this.boundRender);
    }

    renderVisible() {
      const viewportRect = this.viewport.getBoundingClientRect();
      for (let rowIndex = 0; rowIndex < this.rows.length; rowIndex += 1) {
        const row = this.rows[rowIndex];
        const layout = this.layouts[rowIndex];
        const rect = layout.section.getBoundingClientRect();
        const rowBuffer = rect.height || layout.height;
        if (rect.bottom < viewportRect.top - rowBuffer || rect.top > viewportRect.bottom + rowBuffer) {
          this.detachPool(layout);
          continue;
        }
        this.renderRow(rowIndex);
      }
    }

    renderRow(rowIndex, includeFocus = false) {
      const row = this.rows[rowIndex];
      const layout = this.layouts[rowIndex];
      const track = layout.track;
      visibleRangeInto(
        layout.range,
        track.scrollLeft, track.clientWidth, layout.width, layout.gap,
        row.items.length, layout.paddingStart, this.buffer
      );
      let start = layout.range.start;
      let end = layout.range.end;
      if (includeFocus && this.coordinate?.[0] === rowIndex) {
        start = Math.min(start, this.coordinate[1]);
        end = Math.max(end, this.coordinate[1] + 1);
      }
      const activeCount = end - start;
      while (layout.pool.length < activeCount) {
        layout.pool.push(this.createItem());
        layout.indices.push(-1);
      }
      for (let slot = 0; slot < layout.pool.length; slot += 1) {
        const element = layout.pool[slot];
        if (slot >= activeCount) {
          this.releaseFocus(element);
          if (element.parentNode === track) element.remove();
          layout.indices[slot] = -1;
          continue;
        }
        const col = start + slot;
        if (layout.indices[slot] !== col) {
          this.releaseFocus(element);
          this.updateItem(element, row.items[col], row.id, col);
          layout.indices[slot] = col;
          element.style.setProperty('--virtual-x', `${col * (layout.width + layout.gap)}px`);
        }
        if (element.parentNode !== track) track.append(element);
        const item = row.items[col];
        if (!this.prefetched.has(item.id)) {
          this.prefetched.add(item.id);
          this.onItemApproachingViewport(item, row.id, col);
        }
      }
      layout.start = start;
    }

    detachPool(layout) {
      for (let index = 0; index < layout.pool.length; index += 1) {
        const element = layout.pool[index];
        this.releaseFocus(element);
        if (element.parentNode === layout.track) element.remove();
      }
      layout.start = -1;
      for (let index = 0; index < layout.indices.length; index += 1) layout.indices[index] = -1;
    }

    releaseFocus(element) {
      if (element !== this.focusedElement) return;
      element.classList.remove('focused');
      if (element === document.activeElement) this.viewport.focus({ preventScroll: true });
      this.focusedElement = null;
    }

    /** Centre a row/column and focus its recycled node. */
    focusAt(rowIndex, col, { scroll = true, rememberColumn = true, focus = true } = {}) {
      const row = this.rows[rowIndex];
      const layout = this.layouts[rowIndex];
      if (!row || col < 0 || col >= row.items.length) return null;
      if (scroll) {
        const offset = centredScrollOffset(
          col, layout.width, layout.gap, layout.track.clientWidth, row.items.length,
          layout.paddingStart, layout.paddingEnd
        );
        layout.track.scrollLeft = offset;
        const viewportRect = this.viewport.getBoundingClientRect();
        const rowRect = layout.section.getBoundingClientRect();
        const rowTop = this.viewport.scrollTop + rowRect.top - viewportRect.top;
        this.viewport.scrollTop = Math.max(
          0,
          Math.min(
            rowTop + rowRect.height / 2 - this.viewport.clientHeight / 2,
            this.viewport.scrollHeight - this.viewport.clientHeight
          )
        );
      }
      this.coordinate = [rowIndex, col];
      if (rememberColumn) this.preferredColumn = col;
      this.renderVisible();
      this.renderRow(rowIndex, true);
      const layoutState = this.layouts[rowIndex];
      const element = layoutState.pool[col - layoutState.start];
      if (!element || layoutState.indices[col - layoutState.start] !== col) return null;
      if (!focus) return element;
      this.focusedElement?.classList.remove('focused');
      this.focusedElement = element;
      element.classList.add('focused');
      this.isFocusing = true;
      try {
        element.focus({ preventScroll: true });
        this.onFocus(element, row.items[col], this.coordinate);
      } finally {
        this.isFocusing = false;
      }
      return element;
    }

    move(direction) {
      if (!this.coordinate) return false;
      const next = nextCoordinate(this.rows, this.coordinate, this.preferredColumn, direction);
      if (!next) return false;
      this.focusAt(next[0], next[1], { rememberColumn: direction === 'left' || direction === 'right' });
      return true;
    }

    focusTile(id, rowId, options = {}) {
      let rowIndex = -1;
      let col = -1;
      if (rowId && this.itemsByRow.has(rowId)) {
        rowIndex = this.rows.findIndex((row) => row.id === rowId);
        col = this.itemsByRow.get(rowId).get(id) ?? -1;
      }
      if (col < 0) {
        for (let index = 0; index < this.rows.length; index += 1) {
          const match = this.itemsByRow.get(this.rows[index].id)?.get(id);
          if (match !== undefined) { rowIndex = index; col = match; break; }
        }
      }
      if (col < 0) return null;
      return this.focusAt(rowIndex, col, options);
    }

    rememberElement(element) {
      if (!element?.dataset?.tileId) return;
      const rowIndex = this.rows.findIndex((row) => row.id === element.dataset.row);
      if (rowIndex < 0) return;
      const col = this.itemsByRow.get(this.rows[rowIndex].id)?.get(element.dataset.tileId);
      if (col !== undefined) {
        this.coordinate = [rowIndex, col];
        this.preferredColumn = col;
      }
    }

    dispose() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.resizeObserver?.disconnect();
      if (!this.resizeObserver) window.removeEventListener('resize', this.boundResize);
      for (const layout of this.layouts) layout.track.removeEventListener('scroll', layout.scrollListener);
      this.rows = [];
      this.layouts = [];
      this.itemsByRow.clear();
      this.prefetched.clear();
      this.container.replaceChildren();
      this.coordinate = null;
    }
  }

  return { SpatialGrid, visibleRange, centredScrollOffset, verticalColumn, nextCoordinate };
});
