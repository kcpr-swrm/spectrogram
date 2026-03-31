#version 300 es
in vec2 aPosition;
in vec2 aFreqTexCoord;

uniform sampler2D frequencyData;
uniform float texOffsetT;
uniform mat4 mvpMatrix;

out vec3 vColor;
out vec2 vFreqTexCoord;

// https://stackoverflow.com/a/17897228
// by Sam Hocevar, licensed under the WTFPL
// All components are in the range [0,1], including hue.
vec3 hsv2rgb(vec3 hsv) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(hsv.xxx + K.xyz) * 6.0 - K.www);
    return hsv.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), hsv.y);
}

@const float meshScaleZ
@const float meshDx
@const int lastInstance

void main()
{
    float _meshDx = meshDx * float(gl_InstanceID);
    float texDy = float(gl_InstanceID) / float(lastInstance + 1);

    vFreqTexCoord = vec2(aFreqTexCoord.x, aFreqTexCoord.y + texOffsetT + texDy);
    float freqPower = texture(frequencyData, vFreqTexCoord).a;
    vec4 pos = vec4(aPosition.x + _meshDx, aPosition.y, meshScaleZ * freqPower, 1.0);
    gl_Position = mvpMatrix * pos;

    float hue = 1.0 - freqPower;
    vColor = hsv2rgb(vec3(hue, 1.0, 1.0));
}
