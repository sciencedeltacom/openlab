/**
 * The grain ring: a band of noise, drawn as a glowing ring on the GPU.
 *
 * A second decorative surface for the dashboard, used where a chart would be too much: it is
 * clipped by its card, so only the top of the ring shows and the rest runs off the bottom.
 * `aria-hidden`, no data, no interaction beyond the pointer stirring the grain; reduced motion
 * holds one frame.
 */

import { useEffect, useRef, type CSSProperties } from 'react';

import { cn } from '@/lib/cn';

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
uniform vec2  uMouse;
uniform float uHover;
uniform vec3  uBg;
uniform vec3  uBase;
uniform vec3  uAccent;
uniform vec3  uHigh;
uniform float uRadius;
uniform float uWidth;
uniform float uSmear;
uniform float uStir;
uniform float uScale;
uniform float uWarp;

float sat(float x) { return clamp(x, 0.0, 1.0); }

float h21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.56);
    return fract(p.x * p.y);
}

float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = h21(i), b = h21(i + vec2(1.0, 0.0));
    float c = h21(i + vec2(0.0, 1.0)), d = h21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm5(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return s;
}

float fbm3(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.07 + vec2(4.1, 2.3); a *= 0.5; }
    return s;
}

vec2 warp(vec2 p, float t){
  return p + uWarp * vec2(fbm3(p * 1.15 + vec2(t * 0.05, 0.0)), fbm3(p * 1.15 + vec2(4.7, 2.1) - t * 0.04));
}
void main(){
  float ar = uRes.x / max(uRes.y, 1.0);
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (uv - 0.5) * vec2(ar, 1.0);
  float t = uTime;
  float r = length(p);
  float a = atan(p.y, p.x);
  vec2 m = (uMouse - 0.5) * vec2(ar, 1.0);
  float pr = length(m);
  float pang = pr > 1e-4 ? atan(m.y, m.x) : 0.0;
  float spin = pang * uStir * uHover;
  float rad = uRadius * (1.0 + (pr - 0.30) * 1.25 * uHover);
  float da = a - pang;
  da = atan(sin(da), cos(da));
  float dq = da / 0.85;
  float arc = exp(-dq * dq) * uHover;
  vec2 q = warp(vec2(a * uSmear + spin, r * uScale * 3.0 - t * 0.10), t);
  float f = fbm5(q);
  float g = fbm3(q * 2.1 + 7.3);
  float bq = (r - rad) / (rad * uWidth * 0.62);
  float band = exp(-bq * bq);
  float v = sat(band * (0.45 + 1.35 * f) + g * 0.20 * band);
  v *= 1.0 + arc * 0.85;
  vec3 col = uBg;
  col += mix(uBase, uAccent, sat(f * 1.5 - 0.15 + sin(a * 2.0) * 0.28)) * v * 0.72;
  col += uHigh * pow(v, 4.5) * 0.38;
  col += uHigh * band * arc * 0.30;
  col *= 1.0 - 0.90 * exp(-pow(r / (rad * 0.78), 1.7));
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
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

export interface GrainRingProps {
  background?: string;
  baseColor?: string;
  accentColor?: string;
  highlight?: string;
  /** 0–500. */
  speed?: number;
  /** 0–200. */
  hover?: number;
  ring?: { radius?: number; ringWidth?: number; smear?: number; stir?: number };
  field?: { scale?: number; warp?: number };
  className?: string;
  style?: CSSProperties;
}

export function GrainRing({
  background = '#080b12',
  baseColor = '#173a6b',
  accentColor = '#3f8bff',
  highlight = '#dbeaff',
  speed = 70,
  hover = 52,
  ring,
  field,
  className,
  style,
}: GrainRingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, on: 0, onTarget: 0 });
  const values = useRef({ background, baseColor, accentColor, highlight, speed, hover, ring, field });
  values.current = { background, baseColor, accentColor, highlight, speed, hover, ring, field };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false });
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

    const locations: Record<string, WebGLUniformLocation | null> = {};
    const uniform = (name: string) => {
      if (!(name in locations)) locations[name] = gl.getUniformLocation(program, name);
      return locations[name];
    };

    let frame = 0;
    let last = performance.now();
    let clock = 0;

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const v = values.current;
      const ringValues = { radius: 25, ringWidth: 69, smear: 400, stir: 190, ...v.ring };
      const fieldValues = { warp: 55, scale: 20, ...v.field };
      clock = (clock + dt * (Math.max(0, Math.min(500, v.speed)) / 50)) % 3600;

      const state = pointer.current;
      const ease = 1 - Math.exp(-6 * dt);
      state.on += (state.onTarget - state.on) * ease;
      state.x += ((state.onTarget > 0 ? state.tx : 0.5) - state.x) * ease;
      state.y += ((state.onTarget > 0 ? state.ty : 0.5) - state.y) * ease;

      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const width = canvas.clientWidth || 800;
      const height = canvas.clientHeight || 300;
      const bufferWidth = Math.max(1, Math.round(width * dpr));
      const bufferHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
        canvas.width = bufferWidth;
        canvas.height = bufferHeight;
      }
      gl.viewport(0, 0, bufferWidth, bufferHeight);

      gl.uniform2f(uniform('uRes'), bufferWidth, bufferHeight);
      gl.uniform1f(uniform('uTime'), clock);
      gl.uniform2f(uniform('uMouse'), state.x, 1 - state.y);
      gl.uniform1f(uniform('uHover'), Math.min(1, state.on) * Math.max(0, Math.min(2, v.hover / 100)));

      const bg = parseColor(v.background, [0.031, 0.043, 0.071]);
      const base = parseColor(v.baseColor, [0.09, 0.23, 0.42]);
      const accent = parseColor(v.accentColor, [0.25, 0.55, 1]);
      const high = parseColor(v.highlight, [0.86, 0.92, 1]);
      gl.uniform3f(uniform('uBg'), bg[0], bg[1], bg[2]);
      gl.uniform3f(uniform('uBase'), base[0], base[1], base[2]);
      gl.uniform3f(uniform('uAccent'), accent[0], accent[1], accent[2]);
      gl.uniform3f(uniform('uHigh'), high[0], high[1], high[2]);

      gl.uniform1f(uniform('uRadius'), Math.max(8, Math.min(90, ringValues.radius)) / 100);
      gl.uniform1f(uniform('uWidth'), Math.max(20, Math.min(300, ringValues.ringWidth)) / 100);
      gl.uniform1f(uniform('uSmear'), (Math.max(10, Math.min(400, ringValues.smear)) / 100) * 4.5);
      gl.uniform1f(uniform('uStir'), Math.max(0, Math.min(300, ringValues.stir)) / 100);
      gl.uniform1f(uniform('uScale'), Math.max(20, Math.min(400, fieldValues.scale)) / 100);
      gl.uniform1f(uniform('uWarp'), Math.max(0, Math.min(200, fieldValues.warp)) / 100);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      frame = requestAnimationFrame(render);
    };

    const track = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      pointer.current.tx = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      pointer.current.ty = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      pointer.current.onTarget = 1;
    };
    const leave = () => {
      pointer.current.onTarget = 0;
    };

    canvas.addEventListener('pointermove', track);
    canvas.addEventListener('pointerenter', track);
    canvas.addEventListener('pointerleave', leave);
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointermove', track);
      canvas.removeEventListener('pointerenter', track);
      canvas.removeEventListener('pointerleave', leave);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, []);

  return (
    <canvas ref={canvasRef} aria-hidden className={cn('block h-full w-full', className)} style={style} />
  );
}
