import "./App.css";
import React, { useEffect, useState } from "react";
import Camera from "./models/camera";

function App() {
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const camera = new Camera({
      canvas: canvasRef.current!,
      onError: (err) => setError(err),
      onGuidance: (tip) => setGuidance(tip),
    });

    const draw = () => {
      camera.draw();
      requestAnimationFrame(draw);
    };
    camera.init().then(() => {
      requestAnimationFrame(draw);
    });
  }, []);

  return (
    <div>
      {error && <div style={{ color: "red" }}>{error}</div>}
      {!error && guidance && <div style={{ color: "green" }}>{guidance}</div>}
      {/* 选择摄像头 */}
      {devices.length > 1 && (
        <select
          value={selectedDeviceId || ""}
          onChange={(e) => setSelectedDeviceId(e.target.value)}
        >
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `摄像头${d.deviceId}`}
            </option>
          ))}
        </select>
      )}
      {/* 视频预览 */}
      <div>
        <canvas
          ref={canvasRef}
          style={{ width: 400, height: 300, background: "#000" }}
        />
      </div>
      <button onClick={stop}>关闭摄像头</button>
    </div>
  );
}

export default App;
