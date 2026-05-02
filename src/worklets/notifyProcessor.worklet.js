
class NotifyProcessor extends AudioWorkletProcessor {

    #started = false;
    #alive = true;

    constructor(...args) {
        super(...args);
        this.port.onmessage = (e) => {
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
                break;
                default:
            }
//            console.log(e.data);
        };
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
        if (this.#started) {
          // signal new data arrived
          // this is the whole purpose of this worklet
          // everything else is secondary
          this.port.postMessage(null);
        }
        return this.#alive;
    }
}

try {
    registerProcessor('notify-processor', NotifyProcessor);
} catch (e) {
//    console.log(e);
}
