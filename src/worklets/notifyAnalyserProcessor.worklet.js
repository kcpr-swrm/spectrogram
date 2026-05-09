// code based on https://github.com/audiojs/web-audio-api/blob/master/src/AnalyserNode.js (MIT License)

import rfft from 'fourier-transform';

class NotifyAnalyserProcessor extends AudioWorkletProcessor {

    #started = false;
    #alive = true;
    #audioPacketCounter  = 0;

    #fftComputeEveryN = 1;
    #fftSize = 0;
    #minDecibels = -100;
    #maxDecibels = -30;
    #smoothingTimeConstant = 0.8;

    #timeBuf;       // circular time-domain buffer
    #writePos = 0;
    #prevSpectrum;  // smoothed magnitude spectrum
    #spectrum;      // pre-allocated output
    #windowedBuf;   // pre-allocated windowed input for FFT

    #freqDataBuffers = [];

    constructor(opts) {
        super(opts);

        if (opts?.processorOptions) {
            const int_power_of_2 = x => x && !(x & (x - 1));
            this.#fftSize = opts.processorOptions?.fftSize;
            if (this.#fftSize < 32 || this.#fftSize > 32768 || !int_power_of_2(this.#fftSize)) {
                // throw new IndexSizeError('fftSize must be power of 2 between 32 and 32768');
                console.error('fftSize must be power of 2 between 32 and 32768');
            }

            this.#minDecibels = opts.processorOptions?.minDecibels;
            this.#maxDecibels = opts.processorOptions?.maxDecibels;
            if (this.#minDecibels > 0 || this.#maxDecibels > 0 || this.#maxDecibels <= this.#minDecibels) {
                // throw new IndexSizeError('maxDecibels must be greater than minDecibels, both must be <= 0');
                console.error('maxDecibels must be greater than minDecibels, both must be <= 0');
            }
            this.#smoothingTimeConstant = opts.processorOptions?.smoothingTimeConstant;
            if (this.#smoothingTimeConstant < 0 || this.#smoothingTimeConstant > 1) {
                // throw new IndexSizeError('smoothingTimeConstant must be between 0 and 1');
                console.error('smoothingTimeConstant must be between 0 and 1');
            }

            this.#fftComputeEveryN = opts.processorOptions?.fftComputeEveryN ?? 1;
            if (this.#fftComputeEveryN < 1 || !Number.isInteger(this.#fftComputeEveryN)) {
                // throw new IndexSizeError('fftComputeEveryN must be a positive integer');
                console.error('fftComputeEveryN must be a positive integer');
            }
        }

        this.#allocBuffers(this.#fftSize);

        this.port.onmessage = (e) => {
            if (e.data instanceof ArrayBuffer && e.data.byteLength == this.#fftSize / 2) {
                // store the buffer for reuse
                this.#freqDataBuffers.push(e.data);
            } else {
                switch (e.data) {
                    case 'start':
                        this.#started = true;
                    break;
                    case 'stop':
                        this.#started = false;
                    break;
                    case 'kill':
                        this.#started = false;
                        this.#alive = false;
                        this.port.onmessage = null;
                        this.port.close();
                        // cleanup
                        this.#freqDataBuffers.length = 0;
                        this.#freeBuffers();
                    break;
                    default:
                }
            }
//            console.log(e.data);
        };
    }

    #allocBuffers(n) {
        this.#timeBuf = new Float32Array(n);
        this.#prevSpectrum = new Float64Array(n / 2);
        this.#spectrum = new Float64Array(n / 2);
        this.#windowedBuf = new Float64Array(n);
        this.#writePos = 0;
    }

    #freeBuffers() {
        this.#timeBuf = null;
        this.#prevSpectrum = null;
        this.#spectrum = null;
        this.#windowedBuf = null;
    }

    #computeSpectrum() {
        const n = this.#fftSize;
        const bins = n / 2;
        const windowed = this.#windowedBuf;

        // copy ordered time-domain data + apply Blackman window
        for (let i = 0; i < n; i++) {
            const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / n) + 0.08 * Math.cos(4 * Math.PI * i / n);
            windowed[i] = this.#timeBuf[(this.#writePos + i) % n] * w;
        }

        // return normalized magnitude fft spectrum
        const mags = rfft(windowed);

        // compute magnitude spectrum with smoothing
        const smooth = this.#smoothingTimeConstant;
        const prev = this.#prevSpectrum;
        const spectrum = this.#spectrum;
        for (let i = 0; i < bins; i++) {
            // correct magnitude for consistency with native AnalyserNode from web browsers
            const mag = mags[i] / 2;

            spectrum[i] = smooth * prev[i] + (1 - smooth) * mag;
            prev[i] = spectrum[i];
        }

        return spectrum;
    }

    #getByteFrequencyData(array) {
        const spectrum = this.#computeSpectrum();
        const range = this.#maxDecibels - this.#minDecibels;
        const n = Math.min(array.length, spectrum.length);
        for (let i = 0; i < n; i++) {
            const dB = spectrum[i] > 0 ? 20 * Math.log10(spectrum[i]) : this.#minDecibels;
            const scaled = (dB - this.#minDecibels) / range;
            array[i] = Math.max(0, Math.min(255, Math.round(scaled * 255)));
        }
    }

    process(inputs, outputs, params) {
        const sourceLimit = Math.min(inputs.length, outputs.length);

        // pass through
        for (let inputNum = 0; inputNum < sourceLimit; ++inputNum) {
            const input = inputs[inputNum];
            const output = outputs[inputNum];
            const channelCount = Math.min(input.length, output.length);

            for (let channelNum = 0; channelNum < channelCount; ++channelNum) {
                // copy data starting at index 0
                output[channelNum].set(input[channelNum], 0);
            }
        }

        if (this.#started && inputs.length) {
            // compute fft and send it through the port

            // use first input
            const i0channels = inputs[0];
            const channelNum = i0channels.length;
            const n = this.#fftSize;

            i0channels[0].forEach((sample, i) => {
                const offset = (this.#writePos + i) % n;
                this.#timeBuf[offset] = sample;

                // downmix to mono if needed
                if (channelNum > 1) {
                    for (let chan = 1; chan < channelNum; chan++) {
                        this.#timeBuf[offset] += i0channels[chan][i];
                    }
                    this.#timeBuf[offset] /= channelNum;
                }
            });
            this.#writePos = (this.#writePos + i0channels[0].length) % n;

            this.#audioPacketCounter++;
            // only do fft for every fftComputeEveryN packet arrival
            if (this.#audioPacketCounter % this.#fftComputeEveryN == 0) {
                // do fft
                const out = this.#freqDataBuffers.length
                    ? new Uint8Array(this.#freqDataBuffers.pop())
                    : new Uint8Array(n / 2);
                this.#getByteFrequencyData(out);

                // send fft data as message and transfer ownership
                this.port.postMessage(out.buffer, [out.buffer]);
            }
        }

        return this.#alive;
    }
}

try {
    registerProcessor('notify-analyser-processor', NotifyAnalyserProcessor);
} catch (e) {
//    console.log(e);
}
