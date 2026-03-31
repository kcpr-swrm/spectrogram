
class StatsTracker {

    #renderFrameCounter = 0;
    #sampleCounter = 0;
    #printedMs = 0;

    constructor() {
        this.#printedMs = performance.now();
    }

    print() {
        const now = performance.now();
        const diff = now - this.#printedMs;

        const sampleHz = 1000 * this.#sampleCounter / diff;
        const fps = 1000 * this.#renderFrameCounter / diff;

        console.log(`sample Hz: ${sampleHz.toFixed(2)}, fps: ${fps.toFixed(2)}`);

        this.#sampleCounter = 0;
        this.#renderFrameCounter = 0;
        this.#printedMs = now;
    }

    frame() {
        this.#renderFrameCounter++;
    }

    sample() {
        this.#sampleCounter++;
    }

}

export { StatsTracker };
