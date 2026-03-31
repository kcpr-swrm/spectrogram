#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

in vec3 vColor;
in vec2 vFreqTexCoord;

uniform sampler2D frequencyData;

out vec4 fragColor;

void main()
{
    float freqPower = texture(frequencyData, vFreqTexCoord).a;
    fragColor = vec4(freqPower * vColor, 1.0);
}
