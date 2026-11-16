/**
 * Lumenwave: a field of light, drawn as a dot matrix on the GPU.
 *
 * A full-bleed home background. A fixed grid of round dots samples a drifting band of
 * colour; the crest travels left to right and the dots swell and dim with it, so the
 * surface reads as unevenly lit LEDs rather than a printed gradient.
 * The gaps between dots are transparent, which is what lets one shader sit on either theme.
 *
 * It is decoration and says so: `aria-hidden`, no data, no interaction beyond a soft pointer
 * swell. Reduced motion holds a single frame, and a context that cannot be created simply
 * leaves the theme's own background in place.
 */

import { useEffect, useRef, type CSSProperties } from 'react';

import { cn } from '@/lib/cn';

/** Device pixels per CSS pixel are capped, so a 3x display does not quadruple the work. */
const MAX_DPR = 2;

const VERT_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  uRes;
uniform float uTime;
uniform float uDpr;
uniform float uGlow;
uniform float uScale;
uniform float uHover;
uniform vec2  uPtr;
uniform vec3  uBase;
uniform vec3  uAccent;
uniform vec3  uHigh;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.56);
    return fract(p.x * p.y);
}

float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float total = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 3; i++) {
        total += vnoise(p) * amplitude;
        p *= 2.03;
        amplitude *= 0.5;
    }
    return total;
}

void main() {
    // One fixed dot pitch, in device pixels. A finer grid would shimmer under the webview's
    // scaling; this is the pitch that still reads as a matrix on a 2x display.
    float cell = max(6.0 * uDpr, 2.0);
    vec2 ci = floor(gl_FragCoord.xy / cell);
    vec2 cc = (ci + 0.5) * cell;
    vec2 uv = cc / uRes;
    float aspect = uRes.x / max(uRes.y, 1.0);

    // The band field: a soft crest around the middle, bowed by two slow waves so the stripes
    // travel rather than scroll. The bow and the colour are both periodic in uTime.
    float x = uv.x;
    float y = uv.y;
    float t = uTime;
    float bow = 0.055 * sin(x * 3.0 + t * 0.35) + 0.025 * sin(x * 7.0 - t * 0.22);
    float v = y + bow;

    float crest = exp(-pow((v - 0.5) * 2.4, 2.0));
    float halo = exp(-pow((v - 0.5) * 1.1, 2.0));
    float stripe = pow(0.5 + 0.5 * sin((v * 8.0 + x * 1.1 - t * 0.8) * 3.14159), 2.0);
    float travel = 0.35 + 0.65 * (0.5 + 0.5 * sin(x * 2.2 - t * 0.8));

    float light = crest * (0.30 + 0.85 * travel) + halo * 0.14 + stripe * crest * 0.30;
    light *= 0.72 + 0.55 * fbm(vec2(x * 3.0 + t * 0.04, v * 3.0) * uScale);
    light = clamp(light, 0.0, 1.8);

    // A pointer adds a little light around itself, then leaves; nothing else follows the mouse.
    float probe = 0.0;
    if (uHover > 0.001) {
        vec2 delta = (uv - uPtr) * vec2(aspect, 1.0);
        probe = exp(-dot(delta, delta) / 0.045) * uHover;
        light = clamp(light + probe * 0.5, 0.0, 1.8);
    }

    // Dot coverage: a round cell whose radius grows with the light.
    vec2 local = fract(gl_FragCoord.xy / cell) - 0.5;
    float radius = mix(0.26, 0.44, clamp(light, 0.0, 1.0)) + probe * 0.10;
    float dist = length(local);
    float dot = 1.0 - smoothstep(radius - 0.05, radius + 0.02, dist);

    // The ink: the surface itself, the lit accent, and a white-hot core only at the crest.
    // Keeping the unlit dots at the surface colour is what leaves the stage flat blue instead
    // of speckled with dark cells.
    float level = clamp(light, 0.0, 1.0);
    vec3 ink = uBase * (0.82 + 0.18 * halo)
             + uAccent * pow(level, 1.55)
             + uHigh * pow(max(light - 0.55, 0.0), 2.0) * 0.85;

    // The edges fall away, so the centre is the stage and the window frame is not.
    vec2 centred = uv - 0.5;
    float vignette = smoothstep(0.85, 0.15, length(centred * vec2(aspect * 0.8, 1.0)));
    float alpha = dot * clamp(0.10 + light * 0.9, 0.0, 1.0) * vignette * uGlow;

    gl_FragColor = vec4(ink, alpha);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function parseColor(input: string, fallback: [number, number, number]): [number, number, number] {
  const text = input.trim();
  if (text.startsWith('#')) {
    let hex = text.slice(1);
    if (hex.length === 3) {
      hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        return [r / 255, g / 255, b / 255];
      }
    }
    return fallback;
  }
  const match = text.match(/[\d.]+/g);
  if (match && match.length >= 3) {
    return [
      Math.min(255, parseFloat(match[0]!)) / 255,
      Math.min(255, parseFloat(match[1]!)) / 255,
      Math.min(255, parseFloat(match[2]!)) / 255,
    ];
  }
  return fallback;
}

export interface LumenWaveProps {
  /** The dim ink the body of the field is mixed from. */
  baseColor?: string;
  /** The lit colour the crest settles into. */
  accentColor?: string;
  /** The white-hot core along the leading edge. */
  highlight?: string;
  /** Overall opacity, 0–1. The default is low enough to sit behind type. */
  glow?: number;
  /** How tight the banded field is; larger is a closer weave. */
  scale?: number;
  /** How strongly the pointer lights the grid, 0–1. */
  hover?: number;
  className?: string;
  style?: CSSProperties;
}

export function LumenWave({
  baseColor = '#10254f',
  accentColor = '#4f8dff',
  highlight = '#d3e4ff',
  glow = 0.55,
  scale = 1.6,
  hover = 0.5,
  className,
  style,
}: LumenWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ tx: 0.5, ty: 0.5, x: 0.5, y: 0.5, active: false });
  const values = useRef({ baseColor, accentColor, highlight, glow, scale, hover });
  values.current = { baseColor, accentColor, highlight, glow, scale, hover };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false });
    if (!gl) return;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vertex || !fragment) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const locations: Record<string, WebGLUniformLocation | null> = {};
    const uniform = (name: string) => {
      if (!(name in locations)) locations[name] = gl.getUniformLocation(program, name);
      return locations[name];
    };

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let frame = 0;
    let last = performance.now();
    let clock = 12;

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const v = values.current;
      clock += dt;

      const state = pointer.current;
      const ease = 1 - Math.exp(-dt * 8);
      state.x += (state.tx - state.x) * ease;
      state.y += (state.ty - state.y) * ease;

      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const width = canvas.clientWidth || 800;
      const height = canvas.clientHeight || 520;
      const bufferWidth = Math.max(1, Math.round(width * dpr));
      const bufferHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
        canvas.width = bufferWidth;
        canvas.height = bufferHeight;
      }
      gl.viewport(0, 0, bufferWidth, bufferHeight);

      gl.uniform2f(uniform('uRes'), bufferWidth, bufferHeight);
      gl.uniform1f(uniform('uTime'), clock);
      gl.uniform1f(uniform('uDpr'), dpr);
      gl.uniform1f(uniform('uGlow'), Math.max(0, Math.min(1, v.glow)));
      gl.uniform1f(uniform('uScale'), Math.max(0.4, Math.min(6, v.scale)));
      gl.uniform1f(uniform('uHover'), state.active ? Math.max(0, Math.min(1, v.hover)) : 0);
      gl.uniform2f(uniform('uPtr'), state.x, 1 - state.y);

      const base = parseColor(v.baseColor, [0.06, 0.15, 0.31]);
      const accent = parseColor(v.accentColor, [0.31, 0.55, 1]);
      const high = parseColor(v.highlight, [0.83, 0.89, 1]);
      gl.uniform3f(uniform('uBase'), base[0], base[1], base[2]);
      gl.uniform3f(uniform('uAccent'), accent[0], accent[1], accent[2]);
      gl.uniform3f(uniform('uHigh'), high[0], high[1], high[2]);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduced) {
        frame = requestAnimationFrame(render);
      }
    };

    const track = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const state = pointer.current;
      state.tx = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      state.ty = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      state.active = true;
    };
    const leave = () => {
      pointer.current.active = false;
    };

    window.addEventListener('pointermove', track, { passive: true });
    window.addEventListener('pointerleave', leave);
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', track);
      window.removeEventListener('pointerleave', leave);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('pointer-events-none block h-full w-full', className)}
      style={{ display: 'block', ...style }}
    />
  );
}
