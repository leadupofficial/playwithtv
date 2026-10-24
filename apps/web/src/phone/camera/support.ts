/** Camera mode needs a camera API and a secure page (kept tiny: the camera code itself loads on demand). */
export function cameraSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && (typeof isSecureContext === "undefined" || isSecureContext);
}
