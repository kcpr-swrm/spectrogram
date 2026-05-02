import { SpectrogramRenderer } from './spectrogramRenderer.js';
import { WorkletAnalyserSampler } from './samplers/workletAnalyserSampler.js';
import { WorkletSamplingTrigger } from './samplingTriggers/workletSamplingTrigger.js';
import { IntervalSamplingTrigger } from './samplingTriggers/intervalSamplingTrigger.js';

class KaraokeWebIntegration {

    #analyserNode = null;
    #audioSrcNode = null;
    #notifyNode = null;
    #spectrogramRenderer = null;
    #canvasSpectrogram = null;
    #samplingTrigger = null;
    #wakeLock = null;
    #eventAbortController = null;
    #isPlaying = false;

    #config;
    #debug = false;
    #useWakeLock;
    #maxDevicePixelRatio = 1.5;

    constructor(audioSrcNode, config = {}) {
        this.#audioSrcNode = audioSrcNode;

        this.#config = config;
        this.#useWakeLock = config.useWakeLock ?? true;
        this.#debug = config.debug ?? false;

        this.#eventAbortController = new AbortController();
    }

    #setupEvents() {
        window.addEventListener('beforeunload', () => {
            this.destroyVisualizer();
        }, {
            signal: this.#eventAbortController.signal
        });

        document.addEventListener("visibilitychange", () => {
            if (!this.#spectrogramRenderer) return;
            if (document.hidden) {
                this.#samplingTrigger?.stopSamplingFreqData();
            } else {
                if (this.#isPlaying) {
                    this.#samplingTrigger?.startSamplingFreqData();
                }
                if (this.#wakeLock) {
                    // reacquire
                    navigator.wakeLock?.request("screen").then((sentinel) => {
                        this.#wakeLock = sentinel;
                    });
                }
            }
        }, {
            signal: this.#eventAbortController.signal
        });

        const debounce = (func, delay) => {
            let timeout;
            return (...args) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    func.apply(this, args);
                }, delay);
            };
        };

        // needed to handle resizing and zooming properly
        window.addEventListener('resize', debounce(() => {
            this.#resize();
        }, 250),
        {
            signal: this.#eventAbortController.signal
        });
    }

    #resize() {
        if (this.#canvasSpectrogram) {
            const controlsHeight = document.querySelector('.fullscreen-controls-section')?.offsetHeight ?? 0;
            this.#canvasSpectrogram.style.height = `calc(100% - ${controlsHeight}px)`;

            const dpr = Math.min(window.devicePixelRatio || 1, this.#maxDevicePixelRatio);
            this.#canvasSpectrogram.width = Math.round(this.#canvasSpectrogram.clientWidth * dpr);
            this.#canvasSpectrogram.height = Math.round(this.#canvasSpectrogram.clientHeight * dpr);

            if (this.#spectrogramRenderer) {
                this.#spectrogramRenderer.resize(this.#canvasSpectrogram.clientWidth, this.#canvasSpectrogram.clientHeight, dpr);
                if (!this.#isPlaying) {
                    // if rendering is paused, render 1 frame to repaint the resized canvas
                    this.#spectrogramRenderer.render();
                }
            }
        }
    }

    initVisualizerAnalyser(isPlaying) {
        this.#isPlaying = isPlaying;

        this.#setupEvents();
        this.setupCanvas(isPlaying);

//        this.#canvasSpectrogram = this.#canvasSpectrogram.transferControlToOffscreen();
        this.#spectrogramRenderer = new SpectrogramRenderer(this.#canvasSpectrogram, this.#config);

        switch (this.#config.samplingTrigger ?? 'workletAnalyser') {
            case 'interval':
                this.#setupAnalyserNode();
                this.#samplingTrigger = new IntervalSamplingTrigger(this.#spectrogramRenderer);
            break;
            case 'workletAnalyser':
                // analyser node handled differently, workletAnalyser node provides its own analyser
                const fftSize = this.#config.fftSize ?? 4096;
                this.#spectrogramRenderer.hintFrequencyBinCount(fftSize / 2);
                this.#samplingTrigger = new WorkletAnalyserSampler(this.#spectrogramRenderer);

                this.#samplingTrigger.worklet(this.#audioSrcNode.context, this.#config).then(
                    (notifyNode) => {
                        this.#notifyNode = notifyNode;
                        this.#analyserNode = notifyNode;
                        this.#spectrogramRenderer.setAnalyserNode(this.#analyserNode);
                        this.#audioSrcNode.connect(notifyNode);
                        if (this.#debug) console.log('worklet connected');
                        if (isPlaying) {
                            this.#samplingTrigger?.startSamplingFreqData();
                            // this.startVisualizer();
                        }
                    }
                );
            break;
            case 'worklet':
                this.#setupAnalyserNode();
                this.#samplingTrigger = new WorkletSamplingTrigger(this.#spectrogramRenderer);

                this.#samplingTrigger.worklet(this.#audioSrcNode.context).then(
                    (notifyNode) => {
                        this.#notifyNode = notifyNode;
                        this.#analyserNode.connect(notifyNode);
                        if (this.#debug) console.log('worklet connected');
                        if (isPlaying) {
                            this.#samplingTrigger?.startSamplingFreqData();
                            // this.startVisualizer();
                        }
                    }
                );
            break;
            case 'renderer':
            default:
                this.#setupAnalyserNode();
        }
    }

    #setupAnalyserNode() {
        if (this.#audioSrcNode instanceof AnalyserNode) {
            this.#analyserNode = this.#audioSrcNode;
        } else {
            this.#analyserNode = this.#audioSrcNode.context.createAnalyser();
            this.#audioSrcNode.connect(this.#analyserNode);
        }
        const analyserNode = this.#analyserNode;
        const config = this.#config;

        analyserNode.fftSize = config.fftSize ?? 4096;
        analyserNode.smoothingTimeConstant = config.smoothingTimeConstant ?? 0.0;
        analyserNode.minDecibels = config.minDecibels ?? -80;
        analyserNode.maxDecibels = config.maxDecibels ?? -32;

        this.#spectrogramRenderer.setAnalyserNode(analyserNode);
    }

    setupCanvas(isPlaying) {
        this.#canvasSpectrogram ??= document.getElementById('spectrogramCanvas');
        if (!this.#canvasSpectrogram) {
            this.#canvasSpectrogram = document.createElement('canvas');
            this.#canvasSpectrogram.id = "spectrogramCanvas";

            this.#canvasSpectrogram.style.aspectRatio = '1';
            this.#canvasSpectrogram.style.display = 'block';

            const divWrapper = document.createElement('div');
            divWrapper.style.position = 'relative';
            divWrapper.append(this.#canvasSpectrogram);
            divWrapper.addEventListener("click", (e) => {
                e.stopPropagation();
            });

            const wrapper = document.querySelector('.fullscreen-player-overlay');
            wrapper.style.display = 'flex';
            wrapper.prepend(divWrapper);

            // clicking on canvas closes fullscreen mode so let's prevent that
            this.#canvasSpectrogram.addEventListener("click", (e) => {
                e.stopPropagation();
            });

            // fix css
            // performance on low-end devices
            document.querySelector('.fullscreen-overlay').style.background = 'initial'; // no alpha
            document.querySelector('.fullscreen-player-overlay').style.backgroundColor = 'rgba(0,0,0,1)'; // no alpha
            document.querySelector('.fullscreen-artwork-main').style.opacity = '1';
            // layout
            document.querySelector('.fullscreen-artwork-bg').style.position = 'absolute';
            document.querySelector('.fullscreen-artwork-main').style.position = 'absolute';
            document.querySelector('.fullscreen-song-info').style.position = 'absolute';
            // song info outline
            document.querySelector('.fullscreen-song-info').style.textShadow = '-1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000';
            document.querySelector('.fullscreen-artist-name').style.textShadow = 'inherit';

            // hide the other canvas
            document.querySelector('.fullscreen-visualizer-canvas').style.display = 'none';
        }

        this.#resize();

        return true;
    }

    startVisualizer() {
        this.#isPlaying = true;
        if (this.#spectrogramRenderer) {
            this.#samplingTrigger?.startSamplingFreqData();
            if (!this.#wakeLock && this.#useWakeLock) {
                navigator.wakeLock?.request("screen").then((sentinel) => {
                    this.#wakeLock = sentinel;
                });
            }
        }
    }

    animate() {
        this.#spectrogramRenderer?.render();
    }

    destroyVisualizer() {
        this.#isPlaying = false;
        if (this.#spectrogramRenderer) {
            this.#samplingTrigger?.stopSamplingFreqData();
            this.#samplingTrigger?.killSamplingFreqData();
            this.#samplingTrigger = null;
            this.#spectrogramRenderer = null;

            if (this.#analyserNode && this.#notifyNode) {
                if (this.#analyserNode !== this.#notifyNode) {
                    try { this.#analyserNode.disconnect(this.#notifyNode); } catch (e) {
                        if (this.#debug) console.error(e);
                    }
                } else {
                    this.#analyserNode = null;
                }
                // disconnect shouldn't be needed, this is a leaf node
                // but just in case
                this.#notifyNode.disconnect();
                this.#notifyNode = null;
            }

            if (this.#analyserNode && this.#analyserNode !== this.#audioSrcNode) {
                try { this.#audioSrcNode.disconnect(this.#analyserNode); } catch (e) {
                    if (this.#debug) console.error(e);
                }
            }
            this.#analyserNode = null;

            this.#wakeLock?.release().then(() => {
                this.#wakeLock = null;
            });
        }

        // cancel / unregister events
        this.#eventAbortController.abort();

        this.#canvasSpectrogram.style.display = 'none';
        // remove the wrapping div
        this.#canvasSpectrogram.parentNode.remove();
        this.#canvasSpectrogram = null;
    }

    stopVisualizer() {
        this.#isPlaying = false;
        this.#samplingTrigger?.stopSamplingFreqData();
        this.#wakeLock?.release().then(() => {
            this.#wakeLock = null;
        });
    }

}

export default KaraokeWebIntegration;
