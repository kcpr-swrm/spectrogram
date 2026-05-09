import notifyWorkletSrc from '/build/worklets/notifyProcessor.worklet.js';

class WorkletSamplingTrigger {

    #notifyNode = null;
    #samplingActive = false;
    #spectrogramRenderer = null;

    constructor(spectrogramRenderer) {
        this.#spectrogramRenderer = spectrogramRenderer;
    }

    startSamplingFreqData() {
        if (this.#notifyNode) {
            this.#samplingActive = true;
            this.#notifyNode?.port.postMessage('start');
            // console.log(`notifyNode started (startSamplingFreqData): ${this.#notifyNode}`)
        }
    }

    stopSamplingFreqData() {
        if (this.#notifyNode) {
            this.#samplingActive = false;
            this.#notifyNode?.port.postMessage('stop');
            // console.log(`notifyNode stopped (stopSamplingFreqData): ${this.#notifyNode}`)
        }
    }

    killSamplingFreqData() {
        if (this.#notifyNode) {
            // console.log(`notifyNode killed (killSamplingFreqData): ${this.#notifyNode}`)
            this.#notifyNode?.port.postMessage('kill');
            // this.#notifyNode?.port.onmessage = null;
            if (this.#notifyNode) this.#notifyNode.port.onmessage = null;
            this.#notifyNode?.port.close();
            this.#notifyNode = null;
        }
        this.#spectrogramRenderer.setUpdateFreqDataOnRender(true);
    }

    async worklet(audioContext) {
        const blob = new Blob([notifyWorkletSrc], {
            type: 'text/javascript',
        });
        const blobURL = URL.createObjectURL(blob);
        try {
            await audioContext.audioWorklet.addModule(blobURL);
        } catch (e) {console.error(e);}
        URL.revokeObjectURL(blobURL);
        if (this.#notifyNode) {
            this.#notifyNode.port.postMessage('stop');
            this.#notifyNode.port.postMessage('kill');
            this.#notifyNode.port.onmessage = null;
            this.#notifyNode.port.close();
            this.#notifyNode = null;
        }
        this.#notifyNode = new AudioWorkletNode(audioContext, 'notify-processor');

        this.#notifyNode.port.onmessage = (e) => {
            if (this.#samplingActive) {
                this.#spectrogramRenderer.updateFrequencyData();
            } else {
                this.#notifyNode?.port.postMessage('stop');
            }
        }

        this.#spectrogramRenderer.setUpdateFreqDataOnRender(false);
        return this.#notifyNode;
    }
}

export { WorkletSamplingTrigger };
