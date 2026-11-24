/** Fixed-step simulation with variable-rate rendering. */
export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  running = false;

  constructor(
    private update: (dt: number) => void,
    private render: (frameDt: number) => void,
    private step = 1 / 60,
    private maxFrame = 0.1,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      const frame = Math.min((now - this.last) / 1000, this.maxFrame);
      this.last = now;
      this.acc += frame;
      while (this.acc >= this.step) {
        this.update(this.step);
        this.acc -= this.step;
      }
      this.render(frame);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
