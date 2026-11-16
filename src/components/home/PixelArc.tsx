/**
 * The pixel arc: a band of light, drawn as a grid of dots on the GPU.
 *
 * A hero needs a surface that is alive without being a chart, so this is a fragment shader
 * over a pixel grid: one glowing arc, its ink sampled per cell, with a soft probe that follows
 * the pointer. It is decoration and says so — `aria-hidden`, no data, no interaction beyond the
 * glow. Reduced motion holds a single frame.
 *
 * The shader runs in a React component that owns its canvas and cleans up its listeners.
 */

import { useEffect, useRef, type CSSProperties } from 'react';

import { cn } from '@/lib/cn';

const MAX_DPR = 2;

const VERT_SRC = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  uRes;
uniform float uTime, uDpr, uCell, uFill, uHover, uReach;
uniform vec2  uPtr;
uniform float uCenter, uDrop, uThick, uFall;
uniform vec3  uBg, uBase, uAccent, uHigh;

void main(){
  float cs = max(uCell, 2.0);
  vec2 ci = floor(gl_FragCoord.xy / cs);
  vec2 cc = (ci + 0.5) * cs;

  float x = cc.x / uDpr;
  float y = (uRes.y - cc.y) / uDpr;
  float w = uRes.x / uDpr;
  float h = uRes.y / uDpr;

  float nx = (x / w) * 2.0 - 1.0;
  float curveY = h * uCenter + pow(abs(nx), 1.8) * (h * uDrop);
  float i = max(0.0, 1.0 - abs(y - curveY) / max(h * uThick, 1.0));

  float probe = (1.0 - smoothstep(0.0, 1.0, distance(vec2(x, y), uPtr) / max(uReach, 1.0))) * uHover;
  i = clamp(i + probe * 0.45, 0.0, 1.2);

  vec3 col = uBg;
  if (i > 0.01) {
    float wave1 = sin(nx * 4.0 - uTime * 1.5) * 0.1;
    float wave2 = cos(y * 0.01 + uTime) * 0.1;
    i = clamp(i + wave1 + wave2, 0.0, 1.0);
    i *= max(0.0, 1.0 - pow(abs(nx), uFall));

    if (i > 0.02) {
      float side = cs * uFill;
      vec2 d = abs(gl_FragCoord.xy - cc);
      float cov = 1.0 - smoothstep(side * 0.5 - 1.0, side * 0.5 + 1.0, max(d.x, d.y));

      float core = i * i * i;
      float mid = pow(i, 1.5);
      vec3 ink = uBase * i * 0.35 + uAccent * mid * 0.95 + uHigh * core * 0.35;
      col = mix(uBg, clamp(ink, 0.0, 1.0), cov * i);
    }
  }
  gl_FragColor = vec4(col, 1.0);
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

export interface PixelArcProps {
  background?: string;
  /** The dim ink the arc's body is mixed from. */
  baseColor?: string;
  /** The lit colour. */
  accentColor?: string;
  /** The colour of the arc's core. */
  highlight?: string;
  /** Dots across the short side. */
  density?: number;
  /** Dot size, 20–100. */
  dotSize?: number;
  /** Animation speed, 0–100. */
  speed?: number;
  /** How strongly the pointer lights the grid, 0–200. */
  hover?: number;
  arc?: { center?: number; drop?: number; thickness?: number; falloff?: number };
  className?: string;
  style?: CSSProperties;
}

export function PixelArc({
  background = '#0a0d14',
  baseColor = '#173a6b',
  accentColor = '#3f8bff',
  highlight = '#dbeaff',
  density = 92,
  dotSize = 62,
  speed = 45,
  hover = 45,
  arc,
  className,
  style,
}: PixelArcProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ tx: -1, ty: -1, x: -1, y: -1 });
  // Read by the render loop, so a new prop is a value change rather than a shader rebuild.
  const values = useRef({
    background,
    baseColor,
    accentColor,
    highlight,
    density,
    dotSize,
    speed,
    hover,
    arc,
  });
  values.current = { background, baseColor, accentColor, highlight, density, dotSize, speed, hover, arc };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false });
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

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let frame = 0;
    let last = performance.now();
    let clock = 0;

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const v = values.current;
      const arcValues = { center: 0.8, drop: 0, thickness: 0.44, falloff: 6, ...v.arc };
      clock = (clock + dt * 1.2 * (Math.max(0, Math.min(100, v.speed)) / 50)) % 6283;

      const state = pointer.current;
      const ease = 1 - Math.exp(-dt * 9);
      state.x += (state.tx - state.x) * ease;
      state.y += (state.ty - state.y) * ease;

      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const width = canvas.clientWidth || 800;
      const height = canvas.clientHeight || 220;
      const bufferWidth = Math.max(1, Math.round(width * dpr));
      const bufferHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
        canvas.width = bufferWidth;
        canvas.height = bufferHeight;
      }
      gl.viewport(0, 0, bufferWidth, bufferHeight);

      const pitch = Math.min(bufferWidth, bufferHeight) / dpr / Math.max(24, Math.min(260, v.density));
      gl.uniform2f(uniform('uRes'), bufferWidth, bufferHeight);
      gl.uniform1f(uniform('uTime'), clock);
      gl.uniform1f(uniform('uDpr'), dpr);
      gl.uniform1f(uniform('uCell'), Math.max(2, pitch * dpr));
      gl.uniform1f(uniform('uFill'), Math.max(0.2, Math.min(1, v.dotSize / 100)));
      gl.uniform1f(uniform('uCenter'), Math.max(0, Math.min(1, arcValues.center)));
      gl.uniform1f(uniform('uDrop'), Math.max(0, arcValues.drop));
      gl.uniform1f(uniform('uThick'), Math.max(0.02, Math.min(1.2, arcValues.thickness)));
      gl.uniform1f(uniform('uFall'), Math.max(0.5, arcValues.falloff));
      gl.uniform1f(uniform('uHover'), Math.max(0, Math.min(2, v.hover / 100)));
      gl.uniform1f(uniform('uReach'), (Math.min(bufferWidth, bufferHeight) / dpr) * 0.28);
      gl.uniform2f(uniform('uPtr'), state.x * (bufferWidth / dpr), state.y * (bufferHeight / dpr));

      const bg = parseColor(v.background, [0.039, 0.051, 0.078]);
      const base = parseColor(v.baseColor, [0.09, 0.23, 0.42]);
      const accent = parseColor(v.accentColor, [0.25, 0.55, 1]);
      const high = parseColor(v.highlight, [0.86, 0.92, 1]);
      gl.uniform3f(uniform('uBg'), bg[0], bg[1], bg[2]);
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
      pointer.current.tx = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      pointer.current.ty = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    };
    const leave = () => {
      pointer.current.tx = -1;
      pointer.current.ty = -1;
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
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('block h-full w-full', className)}
      style={{ display: 'block', ...style }}
    />
  );
}
