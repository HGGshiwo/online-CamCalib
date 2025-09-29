import './App.css'

import React, { useEffect, useState } from "react";

function App() {

  useEffect(()=>{
    let camera = new Camera({
      canvas: document.createElement("canvas"),
      onError: (err) => setError(err),
      onGuidance: (tip) => setGuidance(tip)
    })

  }, [])
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
        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{ width: 400, height: 300, background: "#000" }}
        />
      </div>

      <button onClick={() => captureWithGuidance(5)}>开始标定</button>
      <button onClick={stop}>关闭摄像头</button>
    </div>
  );
}

export default App
