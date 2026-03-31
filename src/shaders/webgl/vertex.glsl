attribute vec2 aPosition;
attribute vec2 aFreqTexCoord;

uniform sampler2D frequencyData;
uniform float texOffsetT;
uniform mat4 mvpMatrix;

varying vec3 vColor;
varying vec2 vFreqTexCoord;

// https://stackoverflow.com/a/17897228
// by Sam Hocevar, licensed under the WTFPL
// All components are in the range [0,1], including hue.
vec3 hsv2rgb(vec3 hsv) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(hsv.xxx + K.xyz) * 6.0 - K.www);
    return hsv.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), hsv.y);
}

@const float meshScaleZ

void main()
{
    vFreqTexCoord = vec2(aFreqTexCoord.x, aFreqTexCoord.y + texOffsetT);
    float freqPower = texture2D(frequencyData, vFreqTexCoord).a;
    vec4 pos = vec4(aPosition.xy, meshScaleZ * freqPower, 1.0);
    gl_Position = mvpMatrix * pos;

    float hue = 1.0 - freqPower;
    vColor = hsv2rgb(vec3(hue, 1.0, 1.0));
}
