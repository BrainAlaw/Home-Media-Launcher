(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MenuMotion = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class SpringValue {
    constructor(value = 0, { stiffness = 420, damping = 32, mass = 1 } = {}) {
      if (![value, stiffness, damping, mass].every(Number.isFinite) || stiffness <= 0 || damping <= 0 || mass <= 0) throw new Error('Invalid spring parameters');
      this.value = value; this.target = value; this.velocity = 0;
      this.stiffness = stiffness; this.damping = damping; this.mass = mass;
    }

    step(seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      if (seconds > 0.2) { this.snap(); return; }
      const steps = Math.ceil(seconds * 240);
      const dt = seconds / steps;
      for (let index = 0; index < steps; index++) {
        const force = this.stiffness * (this.target - this.value) - this.damping * this.velocity;
        this.velocity += force / this.mass * dt;
        this.value += this.velocity * dt;
      }
      if (this.settled) this.snap();
    }

    get settled() { return Math.abs(this.target - this.value) < 0.001 && Math.abs(this.velocity) < 0.01; }
    snap() { this.value = this.target; this.velocity = 0; }
  }

  /** Callback scheduler for consumers that animate state beyond compositor properties. */
  class MotionScheduler {
    constructor({ requestFrame = (callback) => requestAnimationFrame(callback), cancelFrame = (id) => cancelAnimationFrame(id), reducedMotion = false } = {}) {
      this.requestFrame = requestFrame; this.cancelFrame = cancelFrame; this.reducedMotion = reducedMotion;
      this.motions = new Set(); this.frame = null; this.lastTime = null; this.disposed = false;
    }

    create(initial, render, parameters) {
      const springs = Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, new SpringValue(value, parameters)]));
      const draw = () => render(Object.fromEntries(Object.entries(springs).map(([key, spring]) => [key, spring.value])));
      const motion = {
        springs, draw,
        to: (targets, impulse = {}) => {
          for (const [key, value] of Object.entries(targets)) if (!springs[key] || !Number.isFinite(value)) throw new Error('Invalid spring target');
          for (const [key, value] of Object.entries(targets)) springs[key].target = value;
          for (const [key, velocity] of Object.entries(impulse)) if (springs[key] && Number.isFinite(velocity)) springs[key].velocity += velocity;
          if (this.reducedMotion) { motion.snap(); return; }
          this.motions.add(motion); this.wake();
        },
        snap: (targets = {}) => {
          for (const [key, value] of Object.entries(targets)) if (springs[key] && Number.isFinite(value)) springs[key].target = value;
          Object.values(springs).forEach((spring) => spring.snap()); this.motions.delete(motion); draw();
        },
        dispose: () => this.motions.delete(motion)
      };
      draw(); return motion;
    }

    wake() {
      if (this.frame !== null || this.disposed) return;
      this.frame = this.requestFrame((time) => {
        this.frame = null;
        const dt = this.lastTime === null ? 1 / 120 : Math.max(0, (time - this.lastTime) / 1000); this.lastTime = time;
        for (const motion of [...this.motions]) {
          Object.values(motion.springs).forEach((spring) => spring.step(dt)); motion.draw();
          if (Object.values(motion.springs).every((spring) => spring.settled)) this.motions.delete(motion);
        }
        if (this.motions.size) this.wake(); else this.lastTime = null;
      });
    }

    setReducedMotion(reduced) {
      this.reducedMotion = reduced;
      if (reduced) {
        for (const motion of [...this.motions]) motion.snap();
        if (this.frame !== null) this.cancelFrame(this.frame);
        this.frame = null; this.lastTime = null;
      }
    }

    dispose() { this.disposed = true; if (this.frame !== null) this.cancelFrame(this.frame); this.frame = null; this.motions.clear(); }
  }

  /** Sample physical trajectories once per retarget; Chromium plays transforms on its compositor. */
  class CompositorScheduler {
    constructor({ reducedMotion = false } = {}) { this.reducedMotion = reducedMotion; this.motions = new Set(); }

    create(initial, bindings, parameters, onRest = () => {}) {
      const springs = Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, new SpringValue(value, parameters)]));
      let effects = []; let snapshot = null; let generation = 0; let duration = 0;
      const values = () => Object.fromEntries(Object.entries(springs).map(([key, spring]) => [key, spring.value]));
      const draw = (state) => { for (const binding of bindings) Object.assign(binding.element.style, binding.style(state)); };
      const clone = (source) => Object.fromEntries(Object.entries(source).map(([key, spring]) => {
        const copy = new SpringValue(spring.value, parameters); copy.target = spring.target; copy.velocity = spring.velocity; return [key, copy];
      }));
      const cancel = () => { generation++; for (const effect of effects) effect.cancel(); effects = []; this.motions.delete(motion); };
      const sample = () => {
        if (!snapshot || !effects.length) return;
        const elapsed = Math.max(0, Math.min(duration, Number(effects[0].currentTime) || 0)) / 1000;
        const current = clone(snapshot);
        let remaining = elapsed;
        while (remaining > 0) { const dt = Math.min(1 / 120, remaining); Object.values(current).forEach((spring) => spring.step(dt)); remaining -= dt; }
        for (const [key, spring] of Object.entries(current)) { springs[key].value = spring.value; springs[key].velocity = spring.velocity; }
      };
      const finish = () => {
        for (const spring of Object.values(springs)) spring.snap();
        draw(values()); cancel(); snapshot = null; onRest();
      };
      const motion = {
        springs,
        to: (targets, impulse = {}) => {
          for (const [key, value] of Object.entries(targets)) if (!springs[key] || !Number.isFinite(value)) throw new Error('Invalid spring target');
          if (Object.entries(targets).every(([key, value]) => springs[key].target === value) && !Object.values(impulse).some((value) => Number.isFinite(value) && value !== 0)) return;
          sample(); cancel();
          for (const [key, value] of Object.entries(targets)) springs[key].target = value;
          for (const [key, velocity] of Object.entries(impulse)) if (springs[key] && Number.isFinite(velocity)) springs[key].velocity += velocity;
          if (this.reducedMotion) { finish(); return; }
          snapshot = clone(springs);
          const simulation = clone(springs);
          const frames = [values()];
          for (let index = 0; index < 240; index++) {
            for (const spring of Object.values(simulation)) spring.step(1 / 120);
            frames.push(Object.fromEntries(Object.entries(simulation).map(([key, spring]) => [key, spring.value])));
            if (Object.values(simulation).every((spring) => spring.settled)) break;
          }
          // An exact final target prevents accumulated drift after many rapid reversals.
          frames[frames.length - 1] = Object.fromEntries(Object.entries(springs).map(([key, spring]) => [key, spring.target]));
          duration = (frames.length - 1) * 1000 / 120;
          draw(frames[0]);
          const token = generation;
          for (const binding of bindings) {
            const keyframes = frames.map(binding.style);
            if (keyframes.every((frame) => Object.keys(frame).every((key) => frame[key] === keyframes[0][key]))) continue;
            // Linear interpolation is only between 120 Hz physical samples, not the focus easing curve.
            const effect = binding.element.animate(keyframes, { duration, easing: 'linear', fill: 'both' });
            effects.push(effect);
          }
          if (!effects.length) { finish(); return; }
          this.motions.add(motion);
          let remaining = effects.length;
          for (const effect of effects) effect.onfinish = () => { if (token === generation && --remaining === 0) finish(); };
        },
        snap: (targets = {}) => {
          cancel();
          for (const [key, value] of Object.entries(targets)) if (springs[key] && Number.isFinite(value)) springs[key].target = value;
          finish();
        },
        dispose: cancel
      };
      draw(values());
      return motion;
    }

    setReducedMotion(reduced) { this.reducedMotion = reduced; if (reduced) for (const motion of [...this.motions]) motion.snap(); }
    dispose() { for (const motion of [...this.motions]) motion.dispose(); }
  }

  return { SpringValue, MotionScheduler, CompositorScheduler };
});
