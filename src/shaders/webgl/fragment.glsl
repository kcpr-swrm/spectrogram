#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec3 vColor;
varying vec2 vFreqTexCoord;

uniform sampler2D frequencyData;

void main()
{
    float freqPower = texture2D(frequencyData, vFreqTexCoord).a;
    gl_FragColor = vec4(freqPower * vColor, 1.0);
}
