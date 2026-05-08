import notifyAnalyserWorkletSrc from '/build/worklets/notifyAnalyserProcessor.worklet.js';

class AnalyserAudioWorkletNode extends AudioWorkletNode {
    #fftSize = 2048;

    constructor(...args) {
        super(...args);

        this.#fftSize = args[2]?.processorOptions?.fftSize ?? 2048;
    }

    get frequencyBinCount() {
        return this.#fftSize / 2;
    }
}

class WorkletAnalyserSampler {

    #notifyAnalyserNode = null;
    #samplingActive = false;
    #spectrogramRenderer = null;

    constructor(spectrogramRenderer) {
        this.#spectrogramRenderer = spectrogramRenderer;
    }

    startSamplingFreqData() {
        if (this.#notifyAnalyserNode) {
            this.#samplingActive = true;
            this.#notifyAnalyserNode?.port.postMessage('start');
            // console.log(`notifyAnalyserNode started (startSamplingFreqData): ${this.#notifyAnalyserNode}`)
        }
    }

    stopSamplingFreqData() {
        if (this.#notifyAnalyserNode) {
            this.#samplingActive = false;
            this.#notifyAnalyserNode?.port.postMessage('stop');
            // console.log(`notifyAnalyserNode stopped (stopSamplingFreqData): ${this.#notifyAnalyserNode}`)
        }
    }

    killSamplingFreqData() {
        if (this.#notifyAnalyserNode) {
            // console.log(`notifyAnalyserNode killed (killSamplingFreqData): ${this.#notifyAnalyserNode}`)
            this.#notifyAnalyserNode?.port.postMessage('kill');
            this.#notifyAnalyserNode = null;
        }
        this.#spectrogramRenderer.setUpdateFreqDataOnRender(true);
    }

    async worklet(audioContext, config = {}) {
        const blob = new Blob([notifyAnalyserWorkletSrc], {
            type: 'text/javascript',
        });
        const blobURL = URL.createObjectURL(blob);
        try {
            await audioContext.audioWorklet.addModule(blobURL);
        } catch (e) {console.error(e);}
        URL.revokeObjectURL(blobURL);
        if (this.#notifyAnalyserNode) {
            this.#notifyAnalyserNode.port.postMessage('stop');
            this.#notifyAnalyserNode.port.postMessage('kill');
            this.#notifyAnalyserNode = null;
        }

        const opts = {
            processorOptions: {
                fftSize: config.fftSize ?? 4096,
                minDecibels: config.minDecibels ?? -80,
                maxDecibels: config.maxDecibels ?? -32,
                smoothingTimeConstant: config.smoothingTimeConstant ?? 0.0,
                fftComputeEveryN: config.fftComputeEveryN ?? 1,
            },
        };
        this.#notifyAnalyserNode = new AnalyserAudioWorkletNode(audioContext, 'notify-analyser-processor', opts);

        const reuseFreqDataBuffers = config.reuseFreqDataBuffers ?? true;
        this.#notifyAnalyserNode.port.onmessage = (e) => {
            if (this.#samplingActive) {
                // pass the fft data to the renderer
                this.#spectrogramRenderer.updateFrequencyData(e.data);
                if (reuseFreqDataBuffers) {
                    // send the buffer back (transfer ownership)
                    this.#notifyAnalyserNode?.port.postMessage(e.data, [e.data]);
                }
            } else {
                this.#notifyAnalyserNode?.port.postMessage('stop');
            }
        }

        this.#spectrogramRenderer.setUpdateFreqDataOnRender(false);
        return this.#notifyAnalyserNode;
    }
}

export { WorkletAnalyserSampler };
