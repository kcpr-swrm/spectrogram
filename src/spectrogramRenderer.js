import FragmentShader from './shaders/webgl/fragment.glsl';
import VertexShader from './shaders/webgl/vertex.glsl';
import FragmentShaderInstancing from './shaders/webgl2/fragment.glsl';
import VertexShaderInstancing from './shaders/webgl2/vertex.glsl';

import { RingBuffer } from './ringBuffer.js';
import { StatsTracker } from './statsTracker.js';

import { glMatrix, mat4 } from 'gl-matrix';
import { default as FpsStats } from 'stats.js';


class SpectrogramRenderer {

    #meshSize = 10.0;
    #meshDensityX;
    #meshDensityY;
    #meshScaleZ;
    #freqTextureSize;
    #freqScaleBase;

    #useInstancing;
    #useInterleavedAttribs;
    #skipIndices;
    #antialias;


    #updateFreqDataOnRender = true;
    #freqByteBuffer = null;
    #freqRingBuffer = null;
    #freqTexture = null;
    #texOffsetT = 0;

    #statsTracker = null;

    #gl = null;
    #analyserNode = null;

    #meshPrimitiveType;
    #indicesArrayType;
    #indexGlType;
    #meshNumVertices;
    #meshNumIndices;

    #meshDx = 0.0;
    #progInfo = {
        prog: null,
        attrLocs: {},
        uniLocs: {},
    };

    #mvpMatrix = null;
    #mvpMatrixDirty = true;

    #camera;

    #debug = false;
    #statsUi = false;
    #fpsStats = null;
    #sampleStats = null;

    #useRingBuffer = true;
    #useProvokingVertex = false;

    constructor(canvas, config = {}) {
        this.#meshScaleZ = config.meshScaleZ ?? this.#meshSize * 0.16667;
        this.#meshDensityX = config.meshDensityX ?? 8 * 128;
        this.#meshDensityY = config.meshDensityY ?? 5 * 128;
        this.#freqTextureSize = config.freqTextureSize ?? 8 * 256;
        this.#freqScaleBase = config.freqScaleBase ?? 225.0;

        this.#useInstancing = config.useInstancing ?? true;
        this.#useInterleavedAttribs = config.useInterleavedAttribs ?? false;
        this.#skipIndices = config.skipIndices ?? true;
        this.#antialias = config.antialias ?? false;

        this.#useRingBuffer = config.useRingBuffer ?? true;
        this.#useProvokingVertex = config.useProvokingVertex ?? false;

        this.#debug = config.debug ?? false;
        this.#statsUi = config.statsUi ?? false;

        if (this.#debug && !this.#statsUi) {
            this.#statsTracker = new StatsTracker();
        }

        if (this.#statsUi) {
            this.#fpsStats = new FpsStats();
            this.#sampleStats = new FpsStats();
            const domFps = this.#fpsStats.dom;
            domFps.style.left = '70px';
            domFps.style.position = 'absolute';
            domFps.style.opacity = '1';
            canvas.parentNode.appendChild(domFps);
            const domSample = this.#sampleStats.dom;
            domSample.style.left = '150px';
            domSample.style.position = 'absolute';
            domSample.style.opacity = '1';
            canvas.parentNode.appendChild(domSample);
        }

        this.#camera = {
            x: -2.0,
            y: 0.75,
            z: -10.52,

            xRotDegrees: 0,
            yRotDegrees: 0,
            zRotDegrees: 0,

            // field of view
            fov: {
                upDegrees: 26,
                downDegrees: 26,
                leftDegrees: 36,
                rightDegrees: 19.5,
            },
        };

        this.#setupRendering(canvas);
    }

    #getAvailableContext(canvas, contextTypes) {
        for (const contextType of contextTypes) {
            try {
                const context = canvas.getContext(contextType, {
                    antialias: this.#antialias,
                });
                if (context !== null)
                    return context;
            } catch {}
        }
        return null;
    }

    #setupRendering(canvas) {
        const meshDensityX = this.#meshDensityX;
        const meshDensityY = this.#meshDensityY;
        const freqTextureSize = this.#freqTextureSize;

        const gl = this.#getAvailableContext(canvas, ['webgl2', 'webgl', 'experimental-webgl']);
        this.#gl = gl;

        if (this.#debug) {
            console.log(gl.getParameter(gl.VERSION));
            console.log(gl.getParameter(gl.SHADING_LANGUAGE_VERSION));
        }

        const isWebgl1 = (gl instanceof WebGLRenderingContext);
        if (isWebgl1) {
            // no instancing available
            // actually TODO - use extension if available / polyfill
            // most likely not worth the effort anymore
            this.#useInstancing = false;
        }

        if (!this.#useInstancing && this.#skipIndices) {
            if (this.#debug) console.log("can't really skip indices without instancing");
            this.#skipIndices = false;
        }

        if (!gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS)) {
            throw new Error('no vertex texture units available');
        }

        if (this.#useProvokingVertex) {
            const epv = gl.getExtension('WEBGL_provoking_vertex');
            if (epv) {
                if (this.#debug) console.log('using WEBGL_provoking_vertex');
                // this might help with performance apparently
                // https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#use_webgl_provoking_vertex_when_its_available

                epv.provokingVertexWEBGL(epv.FIRST_VERTEX_CONVENTION_WEBGL);
            }
        }

        const int_power_of_2 = x => x && !(x & (x - 1));
        if (isWebgl1 && !int_power_of_2(freqTextureSize)) {
            throw new Error('non power 2 sized textures not supported');
        }

        const genMeshColumns = this.#useInstancing ? 2 : meshDensityX;
        const numVertices = genMeshColumns * meshDensityY;
        if (numVertices >= 65536 || numVertices > 65536 && (this.#skipIndices || isWebgl1)) {
            if (isWebgl1 && !gl.getExtension("OES_element_index_uint")
                && (!this.#useInstancing || !this.#skipIndices)
               ) {
                throw new Error("32 bit indices not supported and mesh resolution is too high for 16 bit indices");
            }
            this.#indicesArrayType = Uint32Array;
            this.#indexGlType = gl.UNSIGNED_INT;
        } else {
            this.#indicesArrayType = Uint16Array;
            this.#indexGlType = gl.UNSIGNED_SHORT;
        }
        this.#meshNumVertices = numVertices;

        const [vertices, texCoords] = this.#generateVertices(numVertices, genMeshColumns);

        const vboTexCoordOffset = vertices.byteLength;

        // vertex buffer
        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

        // components
        if (this.#useInterleavedAttribs) {
            // interleave
            const combined = this.#interleaveAttribs(numVertices, vertices, texCoords);
            gl.bufferData(gl.ARRAY_BUFFER, combined.byteLength, gl.STATIC_DRAW);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, combined);
        } else {
            // separate
            gl.bufferData(gl.ARRAY_BUFFER, vboTexCoordOffset + texCoords.byteLength, gl.STATIC_DRAW);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
            gl.bufferSubData(gl.ARRAY_BUFFER, vboTexCoordOffset, texCoords);
        }

        if (!this.#skipIndices) {
            // indices
            const indices = this.#generateIndices(isWebgl1);

            // index buffer
            const indexBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        }

        // needed for the shader template / uniform
        const mvpMatrix = this.#computeMvpMatrix();

        // load the shaders
        const progInfo = this.#progInfo;
        if (isWebgl1 || !this.#useInstancing) {
            let vertexSource = VertexShader.sourceCode.replaceAll(
                VertexShader.consts.meshScaleZ.variableName,
                this.#meshScaleZ
                );
            progInfo.prog = this.#loadProgram(vertexSource, FragmentShader.sourceCode);
        } else {
            let vertexSource = VertexShaderInstancing.sourceCode.replaceAll(
                VertexShaderInstancing.consts.meshScaleZ.variableName,
                this.#meshScaleZ
                );
            vertexSource = vertexSource.replaceAll(
                VertexShaderInstancing.consts.meshDx.variableName,
                this.#meshDx
                );
            vertexSource = vertexSource.replaceAll(
                VertexShaderInstancing.consts.lastInstance.variableName,
                this.#meshDensityX
                );
            progInfo.prog = this.#loadProgram(vertexSource, FragmentShaderInstancing.sourceCode);
        }

        gl.useProgram(progInfo.prog);

        // attrib locations
        progInfo.attrLocs.aPosition = gl.getAttribLocation(progInfo.prog, 'aPosition');
        progInfo.attrLocs.aFreqTexCoord = gl.getAttribLocation(progInfo.prog, 'aFreqTexCoord');

        // uniform locations
        progInfo.uniLocs.texOffsetT = gl.getUniformLocation(progInfo.prog, 'texOffsetT');
        progInfo.uniLocs.mvpMatrix = gl.getUniformLocation(progInfo.prog, 'mvpMatrix');
        progInfo.uniLocs.frequencyData = gl.getUniformLocation(progInfo.prog, 'frequencyData');

        // set uniforms
        gl.uniformMatrix4fv(progInfo.uniLocs.mvpMatrix, gl.FALSE, mvpMatrix);
        // texture 0
        gl.uniform1i(progInfo.uniLocs.frequencyData, 0);

        // set attribs
        // 2 components per vertex and 2 per texture coord
        const stride = !this.#useInterleavedAttribs ? 0 : (2 + 2) * Float32Array.BYTES_PER_ELEMENT;
        gl.vertexAttribPointer(progInfo.attrLocs.aPosition, 2, gl.FLOAT, gl.FALSE, stride, 0);

        const texOffset = !this.#useInterleavedAttribs ? vboTexCoordOffset : 2 * Float32Array.BYTES_PER_ELEMENT;
        gl.vertexAttribPointer(progInfo.attrLocs.aFreqTexCoord, 2, gl.FLOAT, gl.FALSE, stride, texOffset);

        gl.clearColor(0, 0, 0, 1);
        gl.enable(gl.DEPTH_TEST);
    }

    #generateVertices(numVertices, genMeshColumns) {
        const gl = this.#gl;
        const meshSize = this.#meshSize;
        const meshDensityX = this.#meshDensityX;
        const meshDensityY = this.#meshDensityY;

        // 2 components per vertex and 2 per texture coord
        const vertices = new Float32Array(numVertices * 2);
        const texCoords = new Float32Array(numVertices * 2);

        if (this.#skipIndices) {
            // 2 columns of vertices (1 column of triangles)
            // in a triangle strip pattern
            if (this.#debug) console.assert(genMeshColumns == 2);
            this.#meshPrimitiveType = gl.TRIANGLE_STRIP;
            for (let y = 0; y < meshDensityY; y++) {
                for (let x = 0; x < genMeshColumns; x++) {
                    vertices[2 * (x + y * genMeshColumns) + 0] = meshSize * (x - meshDensityX / 2) / meshDensityX;
                    vertices[2 * (x + y * genMeshColumns) + 1] = meshSize * (y - meshDensityY / 2) / meshDensityY;

                    const _y = y / (meshDensityY - 1);
                    const _x_off = 2; // helps avoid visual artifacts near the boundary between the oldest and newest frequencies
                    texCoords[2 * (x + y * genMeshColumns) + 0] = Math.pow(this.#freqScaleBase, _y - 1.0);
                    texCoords[2 * (x + y * genMeshColumns) + 1] = (x + _x_off) / (meshDensityX - 1 + 1*_x_off);
                }
            }
            this.#meshDx = vertices[2 * 1 + 0] - vertices[2 * 0 + 0];
        } else {
            // full grid of vertices, arranged in columns

            // this.#meshPrimitiveType determined later in the index generation section
            for (let x = 0; x < genMeshColumns; x++) {
                for (let y = 0; y < meshDensityY; y++) {
                    vertices[2 * (meshDensityY * x + y) + 0] = meshSize * (x - meshDensityX / 2) / meshDensityX;
                    vertices[2 * (meshDensityY * x + y) + 1] = meshSize * (y - meshDensityY / 2) / meshDensityY;

                    const _y = y / (meshDensityY - 1);
                    const _x_off = 2; // helps avoid visual artifacts near the boundary between the oldest and newest frequencies
                    texCoords[2 * (meshDensityY * x + y) + 0] = Math.pow(this.#freqScaleBase, _y - 1.0);
                    texCoords[2 * (meshDensityY * x + y) + 1] = (x + _x_off) / (meshDensityX - 1 + 1*_x_off);
                }
            }
            this.#meshDx = vertices[2 * (meshDensityY * 1 + 0) + 0] - vertices[2 * (meshDensityY * 0 + 0) + 0];
        }
        if (this.#debug) console.log('meshDx: '+this.#meshDx);

        return [vertices, texCoords];
    }

    #interleaveAttribs(numVertices, vertices, texCoords) {
        const combinedSize = vertices.length + texCoords.length;
        const combined = new Float32Array(combinedSize);
        let i = 0;
        for (let v = 0; v < numVertices; v++) {
            for (let nc = 0; nc < 2; nc++) {
                combined[i++] = vertices[2 * v + nc];
            }
            for (let nc = 0; nc < 2; nc++) {
                combined[i++] = texCoords[2 * v + nc];
            }
        }
        if (this.#debug) console.assert(i == combinedSize);

        return combined;
    }

    #generateIndices(isWebgl1) {
        const gl = this.#gl;
        const meshDensityX = this.#meshDensityX;
        const meshDensityY = this.#meshDensityY;

        let indices;
        if (isWebgl1) {
            const meshNumIndices = (meshDensityX - 1) * (meshDensityY - 1) * 6;
            // skip last column for rendering
            this.#meshNumIndices = meshNumIndices - (6 * (meshDensityY - 1) * 1);

            indices = new this.#indicesArrayType(meshNumIndices);

            // TRIANGLES
            this.#meshPrimitiveType = gl.TRIANGLES;
            let idx = 0;
            for (let x = 0; x < meshDensityX - 1; x++) {
                for (let y = 0; y < meshDensityY - 1; y++) {
                    indices[idx++] = x * meshDensityY + y;
                    indices[idx++] = x * meshDensityY + y + 1;
                    indices[idx++] = (x + 1) * meshDensityY + y + 1;
                    indices[idx++] = x * meshDensityY + y;
                    indices[idx++] = (x + 1) * meshDensityY + y + 1;
                    indices[idx++] = (x + 1) * meshDensityY + y;
                }
            }
            if (this.#debug) console.assert(idx == meshNumIndices);
        } else {
            const genMeshColumns = this.#useInstancing ? 1 : meshDensityX - 1;
            const meshNumIndices = ((meshDensityY - 1) * 2 + 3) * genMeshColumns;
            this.#meshNumIndices = meshNumIndices;
            if (!this.#useInstancing) {
                // skip last column for rendering
                this.#meshNumIndices -= ((meshDensityY - 1) * 2 + 3);
            }

            indices = new this.#indicesArrayType(meshNumIndices);

            // TRIANGLE_STRIPS
            this.#meshPrimitiveType = gl.TRIANGLE_STRIP;
            let idx = 0;
            for (let x = 0; x < genMeshColumns; x++) {
                indices[idx++] = (x + 1) * meshDensityY + 0;
                indices[idx++] = x * meshDensityY + 0;
                for (let y = 0; y < meshDensityY - 1; y++) {
                    indices[idx++] = (x + 1) * meshDensityY + y + 1;
                    indices[idx++] = x * meshDensityY + y + 1;
                }
                // terminate the strip
                indices[idx++] = -1;
            }
            if (this.#debug) console.assert(idx == meshNumIndices);
        }

        return indices;
    }

    #computeMvpMatrix() {
        if (!this.#mvpMatrixDirty) {
            return this.#mvpMatrix;
        }
        const camera = this.#camera;

        let projection = mat4.create();
        mat4.perspectiveFromFieldOfView(projection, camera.fov, 1, 100);

        let modelView = mat4.create();
        mat4.rotateX(modelView, modelView, glMatrix.toRadian(camera.xRotDegrees));
        mat4.rotateY(modelView, modelView, glMatrix.toRadian(camera.yRotDegrees));
        mat4.rotateZ(modelView, modelView, glMatrix.toRadian(camera.zRotDegrees));
        mat4.translate(modelView, modelView, [camera.x, camera.y, camera.z]);

        let mvpMatrix = mat4.create();
        mat4.multiply(mvpMatrix, projection, modelView);

        this.#mvpMatrix = mvpMatrix;
        this.#mvpMatrixDirty = false;

        return this.#mvpMatrix;
    }

    #reinitFreqBuffer() {
        if (!this.#freqByteBuffer || this.#freqByteBuffer.length != this.#analyserNode.frequencyBinCount) {
            const gl = this.#gl;
            const freqTextureSize = this.#freqTextureSize;

            const freqByteBuffer = new Uint8Array(this.#analyserNode.frequencyBinCount);
            this.#freqByteBuffer = freqByteBuffer;

            if (this.#useRingBuffer) {
                if (this.#debug) console.log('using ring buffer');
                // 512 samples, each of frequencyBinCount size
                this.#freqRingBuffer = new RingBuffer(512, this.#analyserNode.frequencyBinCount);
            }

            if (this.#freqTexture) {
                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.deleteTexture(this.#freqTexture);
                this.#freqTexture = null;
            }
            const texture = gl.createTexture();
            this.#freqTexture = texture;

            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, freqByteBuffer.length, freqTextureSize, 0, gl.ALPHA, gl.UNSIGNED_BYTE, null);
        }
    }

    updateFrequencyData() {
        const freqTextureSize = this.#freqTextureSize;
        const gl = this.#gl;

        this.#statsTracker?.sample();
        this.#sampleStats?.update();

        if (this.#useRingBuffer) {
            const sampleBuffer = this.#freqRingBuffer.getSampleForWriting();
            this.#analyserNode.getByteFrequencyData(sampleBuffer);
        } else {
            this.#texOffsetT = (this.#texOffsetT + 1) % freqTextureSize;

            const freqByteBuffer = this.#freqByteBuffer;
            this.#analyserNode.getByteFrequencyData(freqByteBuffer);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, this.#texOffsetT, freqByteBuffer.length, 1, gl.ALPHA, gl.UNSIGNED_BYTE, freqByteBuffer);

            if (this.#texOffsetT == 0) {
                this.#statsTracker?.print();
            }
        }

    }

    render() {
        const gl = this.#gl;
        const progInfo = this.#progInfo;
        const meshDensityX = this.#meshDensityX;
        const freqTextureSize = this.#freqTextureSize;

        this.#statsTracker?.frame();
        this.#fpsStats?.update();
        if (this.#updateFreqDataOnRender) {
            this.updateFrequencyData();
        }

        // update frequency texture with data from ring buffer
        if (this.#useRingBuffer && this.#freqRingBuffer.availableSamplesCount()) {

            const sampleSize = this.#freqRingBuffer.getSampleSize();

            // loop handles the edge cases when available data or texture crosses their size and starts over
            do {
                // start writing to the texture at the next position
                const texOffsetT = (this.#texOffsetT + 1) % freqTextureSize;

                const samplesUnilTheEndOfTexture = freqTextureSize - texOffsetT;
                const sampleCount = this.#freqRingBuffer.availableSamplesCount(samplesUnilTheEndOfTexture); // capped
                if (!sampleCount) break;

                const samples = this.#freqRingBuffer.readAvailableSamples(sampleCount);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, texOffsetT, sampleSize, sampleCount, gl.ALPHA, gl.UNSIGNED_BYTE, samples);

                this.#texOffsetT = (this.#texOffsetT + sampleCount) % freqTextureSize;

                if (this.#texOffsetT == 0) {
                    this.#statsTracker?.print();
                }
            } while (true);
        }

        // update uniforms
        const normTexOffsetT = this.#texOffsetT / (freqTextureSize - 1);
        const alignedTexOffsetT = Math.floor(normTexOffsetT * (meshDensityX - 1)) / (meshDensityX - 1);
        gl.uniform1f(progInfo.uniLocs.texOffsetT, alignedTexOffsetT);

        if (this.#mvpMatrixDirty) {
          const mvpMatrix = this.#computeMvpMatrix();
          gl.uniformMatrix4fv(progInfo.uniLocs.mvpMatrix, gl.FALSE, mvpMatrix);
          if (this.#debug) console.log(`new mvp matrix: ${mvpMatrix}`);
        }

        // draw
        gl.enableVertexAttribArray(progInfo.attrLocs.aPosition);
        gl.enableVertexAttribArray(progInfo.attrLocs.aFreqTexCoord);

        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // skip last column
        // helps avoid visual artifacts near the boundary between the oldest and newest frequencies
        const numInstances = meshDensityX - 1;
        if (this.#skipIndices) {
            gl.drawArraysInstanced(this.#meshPrimitiveType, 0, this.#meshNumVertices, numInstances);
        } else {
            if (!this.#useInstancing) {
                gl.drawElements(this.#meshPrimitiveType, this.#meshNumIndices, this.#indexGlType, 0);
            } else {
                gl.drawElementsInstanced(this.#meshPrimitiveType, this.#meshNumIndices, this.#indexGlType, 0, numInstances);
            }
        }
        gl.disableVertexAttribArray(progInfo.attrLocs.aPosition);
        gl.disableVertexAttribArray(progInfo.attrLocs.aFreqTexCoord);
    }

    setAnalyserNode(analyserNode) {
        this.#analyserNode = analyserNode;
        this.#reinitFreqBuffer();
    }

    setUpdateFreqDataOnRender(updateFreqDataOnRender) {
        this.#updateFreqDataOnRender = updateFreqDataOnRender;
    }

    resize(w, h, dpr=1) {
        if (!this.#gl) {
            return;
        }
        const window_w = Math.round(window.innerWidth * dpr);
        const window_h = Math.round(window.innerHeight * dpr);
        w = Math.round(w * dpr);
        h = Math.round(h * dpr);
        const _w = Math.min(w, window_w);
        const _h = Math.min(h, window_h);

        this.#gl.viewport(0, 0, _w, _h);
    }

    #loadProgram(vertexShaderSrc, fragmentShaderSrc) {
        const gl = this.#gl;
        const vertexShader = this.#loadShader(gl.VERTEX_SHADER, vertexShaderSrc);
        const fragmentShader = this.#loadShader(gl.FRAGMENT_SHADER, fragmentShaderSrc);

        const program = gl.createProgram();
        if (program === null) {
            throw new Error('Failed to create program');
        }

        gl.attachShader(program, vertexShader);
        gl.deleteShader(vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.deleteShader(fragmentShader);

        gl.linkProgram(program);
        gl.validateProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const error = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(`program linking error:\n${error}`);
        }

        // gl.releaseShaderCompiler();
        return program;
    }

    #loadShader(type, src) {
        const gl = this.#gl;
        const shader = gl.createShader(type);

        if (shader === null) {
            throw new Error("couldn't create shader");
        }

        gl.shaderSource(shader, src);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const error = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            if (this.#debug) console.log(src);
            throw new Error(`shader compilation error:\n${error}`);
        }

        return shader;
    }
}

export { SpectrogramRenderer };
export default SpectrogramRenderer;
