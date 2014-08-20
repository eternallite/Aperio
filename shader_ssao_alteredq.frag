/*******************************************************************
Fragment
SSAO Post-process Shader : Screen Space Ambient Occlusion Shader 
*******************************************************************/

#version 440 compatibility

/**
* @author alteredq / http://alteredqualia.com/
*
* Screen-space ambient occlusion shader
* - ported from
*   SSAO GLSL shader v1.2
*   assembled by Martins Upitis (martinsh) (http://devlog-martinsh.blogspot.com)
*   original technique is made by ArKano22 (http://www.gamedev.net/topic/550699-ssao-no-halo-artifacts/)
* - modifications
* - modified to use RGBA packed depth texture (use clear color 1,1,1,1 for depth pass)
* - refactoring and optimizations
*/

float cameraNear = 0.02;		
float cameraFar = 1000;
float fogNear = 0.02;		
float fogFar = 1000;
bool fogEnabled = false;  // attenuate AO with linear fog
bool onlyAO = false;      // use only ambient occlusion pass?

uniform sampler2D source;		
uniform sampler2D sourceDepth;
uniform vec2 frameBufSize;        // texture width, height

smooth in vec2 vUv;

float aoClamp = 0.5;    // depth clamp - reduces haloing at screen edges
float lumInfluence = 0.5;  // how much luminance affects occlusion

// #define PI 3.14159265		
#define DL 2.399963229728653  // PI * ( 3.0 - sqrt( 5.0 ) )
#define EULER 2.718281828459045
// helpers

float width = frameBufSize.x;   // texture width
float height = frameBufSize.y;  // texture height

float cameraFarPlusNear = cameraFar + cameraNear;		
float cameraFarMinusNear = cameraFar - cameraNear;		
float cameraCoef = 2.0 * cameraNear;
// user variables

const int samples = 40;     // ao sample count
const float radius = 7.5;  // ao radius

const bool useNoise = false;      // use noise instead of pattern for sample dithering
const float noiseAmount = 0.0003; // dithering amount

const float diffArea = 0.4;   // self-shadowing reduction
const float gDisplace = 0.4;  // gauss bell center

const vec3 onlyAOColor = vec3( 1.0, 0.7, 0.5 );		
// const vec3 onlyAOColor = vec3( 1.0, 1.0, 1.0 );

// RGBA depth

float unpackDepth( const in vec4 rgba_depth ) {
	const vec4 bit_shift = vec4( 1.0 / ( 256.0 * 256.0 * 256.0 ), 1.0 / ( 256.0 * 256.0 ), 1.0 / 256.0, 1.0 );			
	float depth = dot( rgba_depth, bit_shift );			
	return depth;
}
// generating noise / pattern texture for dithering

vec2 rand( const vec2 coord ) {
	vec2 noise;
	if ( useNoise ) {
		float nx = dot ( coord, vec2( 12.9898, 78.233 ) );				
		float ny = dot ( coord, vec2( 12.9898, 78.233 ) * 2.0 );
		noise = clamp( fract ( 43758.5453 * sin( vec2( nx, ny ) ) ), 0.0, 1.0 );
	} else {
		float ff = fract( 1.0 - coord.s * ( width / 2.0 ) );				
		float gg = fract( coord.t * ( height / 2.0 ) );
		noise = vec2( 0.25, 0.75 ) * vec2( ff ) + vec2( 0.75, 0.25 ) * gg;
	}
	return ( noise * 2.0  - 1.0 ) * noiseAmount;
}
float doFog() {
	float zdepth = unpackDepth( texture2D( sourceDepth, vUv ) );			
	float depth = -cameraFar * cameraNear / ( zdepth * cameraFarMinusNear - cameraFar );
	return smoothstep( fogNear, fogFar, depth );
}
float readDepth( const in vec2 coord ) {
	// return ( 2.0 * cameraNear ) / ( cameraFar + cameraNear - unpackDepth( texture2D( sourceDepth, coord ) ) * ( cameraFar - cameraNear ) );			
	return cameraCoef / ( cameraFarPlusNear - unpackDepth( texture2D( sourceDepth, coord ) ) * cameraFarMinusNear );

}
float compareDepths( const in float depth1, const in float depth2, inout int far ) {
	float garea = 2.0;                         // gauss bell width
	float diff = ( depth1 - depth2 ) * 100.0;  // depth difference (0-100)

	// reduce left bell width to avoid self-shadowing

	if ( diff < gDisplace ) {
		garea = diffArea;
	} else {
		far = 1;
	}
	float dd = diff - gDisplace;			
	float gauss = pow( EULER, -2.0 * dd * dd / ( garea * garea ) );			
	return gauss;
}
float calcAO( float depth, float dw, float dh ) {
	float dd = radius - depth * radius;			
	vec2 vv = vec2( dw, dh );
	vec2 coord1 = vUv + dd * vv;			
	vec2 coord2 = vUv - dd * vv;
	float temp1 = 0.0;			
	float temp2 = 0.0;
	int far = 0;			
	temp1 = compareDepths( depth, readDepth( coord1 ), far );
	// DEPTH EXTRAPOLATION

	if ( far > 0 ) {
		temp2 = compareDepths( readDepth( coord2 ), depth, far );				
		temp1 += ( 1.0 - temp1 ) * temp2;
	}
	return temp1;
}
void main() {
	vec2 noise = rand( vUv );			
	float depth = readDepth( vUv );
	float tt = clamp( depth, aoClamp, 1.0 );
	float w = ( 1.0 / width )  / tt + ( noise.x * ( 1.0 - noise.x ) );			
	float h = ( 1.0 / height ) / tt + ( noise.y * ( 1.0 - noise.y ) );
	float pw;			
	float ph;
	float ao;
	float dz = 1.0 / float( samples );			
	float z = 1.0 - dz / 2.0;			
	float l = 0.0;
	for ( int i = 0; i <= samples; i ++ ) {
		float r = sqrt( 1.0 - z );
		pw = cos( l ) * r;				
		ph = sin( l ) * r;				
		ao += calcAO( depth, pw * w, ph * h );				
		z = z - dz;
		l = l + DL;
	}
	ao /= float( samples );			
	ao = 1.0 - ao;
	if ( fogEnabled ) {
		ao = mix( ao, 1.0, doFog() );
	}
	vec3 color = texture2D( source, vUv ).rgb;
	vec3 lumcoeff = vec3( 0.299, 0.587, 0.114 );			
	float lum = dot( color.rgb, lumcoeff );			
	vec3 luminance = vec3( lum );
	vec3 final = vec3( color * mix( vec3( ao ), vec3( 1.0 ), luminance * lumInfluence ) );  // mix( color * ao, white, luminance )

	if ( onlyAO ) {
		final = onlyAOColor * vec3( mix( vec3( ao ), vec3( 1.0 ), luminance * lumInfluence ) );  // ambient occlusion only

	}
	gl_FragColor = vec4( final, 1.0 );
  
  //gl_FragColor = texture2D(source, vUv);
}
