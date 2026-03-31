
class RingBuffer {

    #maxSamples = 0;
    #sampleSize = 0;

    #readingSample = 0;
    #writingSample = 0;

    #data = null;

    constructor(maxSamples, sampleSize) {
        this.#maxSamples = maxSamples;
        this.#sampleSize = sampleSize;
        this.#data = new Uint8Array(maxSamples * sampleSize);
    }

    getSampleSize() {
        return this.#sampleSize;
    }

    getSampleForWriting() {
        const sample = this.#writingSample++;
        if (this.#writingSample >= this.#maxSamples) {
            this.#writingSample = 0;
        }
        if (this.writingSample == this.#readingSample) {
            // overflowing, old sample is lost
            this.#readingSample++;
            if (this.#readingSample == this.#maxSamples) {
                this.#readingSample = 0;
            }
        }
        return new Uint8Array(this.#data.buffer, sample * this.#sampleSize, this.#sampleSize);
    }

    availableSamplesCount(maxSamples = this.#maxSamples) {
        const availableSamples = (this.#readingSample > this.#writingSample) ?
            this.#maxSamples - this.#readingSample :
            this.#writingSample - this.#readingSample;
        return Math.min(availableSamples, maxSamples);
    }

    readAvailableSamples(maxSamples = this.#maxSamples) {
        const sampleCount = this.availableSamplesCount(maxSamples);
        if (!sampleCount) {
            return null;
        }

        const readingSample = this.#readingSample;
        this.#readingSample += sampleCount;
        if (this.#readingSample == this.#maxSamples) {
            this.#readingSample = 0;
        }
        return new Uint8Array(this.#data.buffer, readingSample * this.#sampleSize, sampleCount * this.#sampleSize);
    }

}

export { RingBuffer };
