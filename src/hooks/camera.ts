import { useEffect, useRef, useState, useCallback } from "react";

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function getDevicesWithPermission() {
      try {
        // 先请求权限
        await navigator.mediaDevices.getUserMedia({ video: true });
        // 再获取设备信息
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((d) => d.kind === "videoinput");
        setDevices(videoDevices);
        if (videoDevices.length > 0) {
          setSelectedDeviceId(videoDevices[0].deviceId);
        }
        else {
          setError("未找到摄像头设备");
        }
      } catch (err) {
        setError("无法获取摄像头设备");
      }
    }
    getDevicesWithPermission();
  }, []);

  // 切换摄像头
  useEffect(() => {
    console.log('selectedDeviceId', selectedDeviceId)
    if (!selectedDeviceId) return;

    async function startCamera() {
      setIsReady(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: selectedDeviceId! } },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setIsReady(true);
      } catch (err) {
        setError("无法打开摄像头");
      }
    }
    startCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [selectedDeviceId]);

  // 拍照
  const capture = useCallback(() => {
    if (!videoRef.current) return null;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx!.drawImage(video, 0, 0, canvas.width, canvas.height);
    // 返回base64图片
    return canvas
    // 或返回Blob
    // return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }, []);

  // 释放资源
  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsReady(false);
  }, []);

  return {
    videoRef,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    isReady,
    capture,
    stop,
    error,
  };
}
