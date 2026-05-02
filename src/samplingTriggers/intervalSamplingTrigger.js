
class IntervalSamplingTrigger {

    #samplingTimer = null;
    #samplingActive = false;
    #spectrogramRenderer = null;

    constructor(spectrogramRenderer) {
        this.#spectrogramRenderer = spectrogramRenderer;
        this.#spectrogramRenderer.setUpdateFreqDataOnRender(false);
    }

    startSamplingFreqData() {
        const intervalMs = 0;

        if (this.#samplingTimer) {
            clearInterval(this.#samplingTimer);
            // console.log(`samplingTimer stopped (startSamplingFreqData): ${this.#samplingTimer}`)
        }

        this.#samplingTimer = setInterval( () => {
            this.#spectrogramRenderer.updateFrequencyData();
        }
        , intervalMs);

        this.#samplingActive = true;
        // console.log(`notifyNode started (startSamplingFreqData): ${this.#samplingTimer}`)
    }

    stopSamplingFreqData() {
        if (this.#samplingTimer) {
            clearInterval(this.#samplingTimer);

            // console.log(`samplingTimer stopped (stopSamplingFreqData): ${this.#samplingTimer}`)
            this.#samplingTimer = null;
            this.#samplingActive = false;
        }
    }

    killSamplingFreqData() {
        this.stopSamplingFreqData();
        this.#spectrogramRenderer.setUpdateFreqDataOnRender(true);
    }

}

export { IntervalSamplingTrigger };
