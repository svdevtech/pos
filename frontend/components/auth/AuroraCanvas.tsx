'use client';

import { useEffect, useRef } from 'react';

/**
 * The aurora behind the sign-in page: a full-screen fragment shader (layered value noise) that
 * drifts slowly through three colours. Raw WebGL on purpose — a single quad needs no library,
 * and keeping three.js out of the Next program is a rule of this codebase (see fnb3d/). Stops
 * animating under prefers-reduced-motion and falls back to the CSS gradient behind it when
 * WebGL is unavailable.
 */

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FRAG = `precision highp float;uniform float t;uniform vec2 r;
const vec3 c1=vec3(.043,.102,.29);const vec3 c2=vec3(.298,.114,.584);const vec3 c3=vec3(.055,.455,.565);
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=uv*vec2(r.x/r.y,1.);
float q=fbm(p*1.2+vec2(t*.05,-t*.03));float w=fbm(p*2.+vec2(q*1.5,t*.08));
float band=smoothstep(.25,.75,fbm(vec2(p.x*1.3+t*.04,p.y*.6-q)));
vec3 col=mix(c1,c2,w);col=mix(col,c3,band*.9);
float vig=smoothstep(1.4,.2,length(uv-.5));col*=vig*1.15;col=mix(vec3(.02),col,.92);
gl_FragColor=vec4(col,1.);}`;

export default function AuroraCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // a phone gets the CSS gradient: the showcase is hidden there anyway, and the GPU is spared
    if (window.matchMedia('(max-width: 899px)').matches) {
      canvas.style.display = 'none';
      return;
    }
    const hide = () => {
      canvas.style.display = 'none';
    };
    canvas.addEventListener('webglcontextlost', hide);
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) {
      hide();
      return;
    }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      hide();
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uT = gl.getUniformLocation(prog, 't');
    const uR = gl.getUniformLocation(prog, 'r');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let running = true;
    const resize = () => {
      // one device pixel per CSS pixel is plenty for a blurred aurora, and kind to tablets
      const w = Math.max(1, Math.floor(canvas.clientWidth));
      const h = Math.max(1, Math.floor(canvas.clientHeight));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uR, w, h);
    };
    const start = performance.now();
    const frame = (now: number) => {
      if (!running) return;
      if (gl.isContextLost()) {
        hide();
        return;
      }
      resize();
      gl.uniform1f(uT, reduced ? 0 : (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', resize);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('webglcontextlost', hide);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);
  return <canvas ref={ref} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />;
}
