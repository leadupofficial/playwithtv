/**
 * @playwithtv/motion: the shared motion-control SDK.
 *
 * Phone side: feed DeviceMotion samples into MotionEngine, send `frame()` as axes and gestures as tap counters
 * (see wire.ts). TV side: read them back with MotionReader and build mechanics from tilt, holds and gestures.
 * Everything here is pure TypeScript so it runs in tests on recorded or synthetic traces.
 */
export * from "./vec.js";
export * from "./engine.js";
export * from "./wire.js";
export * from "./trace.js";
export * from "./hold.js";
export * from "./swing.js";
export * from "./beat.js";
export * from "./saber.js";
