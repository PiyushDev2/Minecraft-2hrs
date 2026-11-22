/**
 * @file F3DebugOverlay.tsx
 * @description Java-style F3 Debug HUD with live FPS & frame-time sparkline,
 * WebGL draw calls/triangles/geometries, chunk counts & worker queue, XYZ/Block/Chunk coords,
 * dimension, graphics mode, active resource pack, facing direction, biome, dual-bank light,
 * weather, entity counts, and targeted block inspector.
 */

import React from 'react';

export interface F3Telemetry {
  fps: number;
  frameTimeMs: number;
  frameHistory: number[];
  drawCalls: number;
  triangles: number;
  geometries: number;
  loadedChunks: number;
  dirtyChunks: number;
  workerPending: number;
  renderDistance: number;
  x: number;
  y: number;
  z: number;
  yawDeg: number;
  pitchDeg: number;
  facingLabel: string;
  biome: string;
  dimension: string;
  graphicsMode: string;
  activePackName: string;
  skyLight: number;
  blockLight: number;
  timeOfDay: number;
  weather: string;
  mobsCount: number;
  arrowsCount: number;
  dropsCount: number;
  particlesCount: number;
  seed: number;
  gameMode: string;
  chunkBorders: boolean;
  gpuRenderer: string;
  softwareGl: boolean;
  targetBlock: {
    name: string;
    id: number;
    x: number;
    y: number;
    z: number;
    hardness: number;
    fluidLevel: number;
  } | null;
}

interface F3DebugOverlayProps {
  data: F3Telemetry;
}

function F3Line({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-black/52 px-1.5 py-[1px] text-[11px] sm:text-xs text-[#f2f2f2] leading-tight mc-text-shadow-sm tabular-nums whitespace-nowrap">
      {children}
    </div>
  );
}

export const F3DebugOverlay: React.FC<F3DebugOverlayProps> = ({ data }) => {
  const bx = Math.floor(data.x);
  const by = Math.floor(data.y);
  const bz = Math.floor(data.z);
  const cx = Math.floor(bx / 16);
  const cz = Math.floor(bz / 16);
  const lx = ((bx % 16) + 16) % 16;
  const lz = ((bz % 16) + 16) % 16;
  const dayTick = Math.floor(data.timeOfDay * 24000);
  const dimId = data.dimension === 'nether' ? 'minecraft:the_nether' : 'minecraft:overworld';

  const history = data.frameHistory;
  const sparkPoints = history
    .map((ms, idx) => {
      const px = (idx / Math.max(1, history.length - 1)) * 160;
      const py = 32 - Math.min(32, (ms / 50) * 32);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="fixed inset-x-2 top-2 z-20 pointer-events-none flex items-start justify-between gap-4 select-none">
      {/* Left Column: Engine, Performance, Position, World */}
      <div className="flex flex-col items-start gap-[2px]">
        <F3Line>VoxelCraft 1.21 (WebGL2 / Sub-Chunks / Instanced Pools)</F3Line>
        <F3Line>
          {data.fps} fps ({data.frameTimeMs.toFixed(1)} ms) | C: {data.loadedChunks} (dirty: {data.dirtyChunks}, q: {data.workerPending}) | D: {data.renderDistance}
        </F3Line>
        <F3Line>
          E: {data.mobsCount} mobs, {data.arrowsCount} arrows, {data.dropsCount} drops | P: {data.particlesCount}
        </F3Line>

        {/* Mini Frame-Time Graph */}
        <div className="bg-black/62 border border-white/20 px-1.5 py-1 mt-0.5 mb-1">
          <div className="flex items-center justify-between text-[10px] text-neutral-300 mb-0.5 tabular-nums">
            <span>Frame Time</span>
            <span>16.7ms = 60fps</span>
          </div>
          <svg width="160" height="32" className="block">
            <line x1="0" y1="21.3" x2="160" y2="21.3" stroke="#4ade80" strokeOpacity="0.45" strokeDasharray="2 2" />
            <line x1="0" y1="10.6" x2="160" y2="10.6" stroke="#facc15" strokeOpacity="0.35" strokeDasharray="2 2" />
            {sparkPoints && (
              <polyline
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.5"
                points={sparkPoints}
              />
            )}
          </svg>
        </div>

        <F3Line>
          XYZ: {data.x.toFixed(3)} / {data.y.toFixed(3)} / {data.z.toFixed(3)}
        </F3Line>
        <F3Line>
          Block: {bx} {by} {bz} [{lx} {by & 15} {lz}]
        </F3Line>
        <F3Line>
          Chunk: {cx} {Math.floor(by / 16)} {cz} | Seed: {data.seed}
        </F3Line>
        <F3Line>
          Dimension: {dimId} | Biome: voxelcraft:{data.biome}
        </F3Line>
        <F3Line>
          Facing: {data.facingLabel} ({data.yawDeg.toFixed(1)}° / {data.pitchDeg.toFixed(1)}°)
        </F3Line>
        <F3Line>
          Client Light: {Math.max(data.skyLight, data.blockLight)} ({data.skyLight} sky, {data.blockLight} block) | Weather: {data.weather} | Tick: {dayTick}
        </F3Line>
        <F3Line>
          Mode: {data.gameMode} | F3+G Chunk Borders: {data.chunkBorders ? 'ON' : 'OFF'}
        </F3Line>
      </div>

      {/* Right Column: Renderer Stats, Pack & Targeted Block Inspector */}
      <div className="flex flex-col items-end gap-[2px] max-w-[44vw]">
        <F3Line>Draw Calls: {data.drawCalls} | Triangles: {data.triangles.toLocaleString()}</F3Line>
        <F3Line>Geometries: {data.geometries} | Graphics: {data.graphicsMode} ({data.softwareGl ? 'Software' : 'Hardware'})</F3Line>
        <F3Line>Pack: {data.activePackName}</F3Line>
        <F3Line>GPU: {data.gpuRenderer.slice(0, 44)}</F3Line>

        <div className="h-2" />
        {data.targetBlock ? (
          <>
            <F3Line>
              <span className="text-amber-300">Targeted Block:</span> {data.targetBlock.x}, {data.targetBlock.y}, {data.targetBlock.z}
            </F3Line>
            <F3Line>
              voxelcraft:{data.targetBlock.name.toLowerCase().replace(/\s+/g, '_')} (id={data.targetBlock.id})
            </F3Line>
            <F3Line>
              hardness: {data.targetBlock.hardness < 0 ? 'unbreakable' : data.targetBlock.hardness}
              {data.targetBlock.fluidLevel > 0 ? ` | fluid_lvl: ${data.targetBlock.fluidLevel}` : ''}
            </F3Line>
          </>
        ) : (
          <F3Line>Targeted Block: none</F3Line>
        )}
      </div>
    </div>
  );
};
