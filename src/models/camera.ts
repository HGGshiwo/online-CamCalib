import type { OpenCV } from "@opencvjs/types";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cv = (await (window as any).cv) as typeof OpenCV;

type onReadyCb = (ready: boolean) => unknown;
type onErrorCb = (error: string) => unknown;
type onGuidanceCb = (guidance: string) => unknown;

type CameraConfig = {
  onError?: onErrorCb;
  onReady?: onReadyCb;
  onGuidance?: onGuidanceCb;
  canvas: HTMLCanvasElement;
  fps: number;
};

type BlockConfig = {
  colNum?: number;
  rowNum?: number;
  squareSize: number;
};
type Point = {
  pitch: number;
  yaw: number;
  roll: number;
  distance: number;
};
class Camera {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  onError: onErrorCb | undefined;
  onReady: onReadyCb | undefined;
  onGuidance: onGuidanceCb | undefined;
  video: HTMLVideoElement;
  stream: MediaStream | undefined;
  canvas: HTMLCanvasElement; // 需要显示的video元素
  ctx: CanvasRenderingContext2D | null;
  colNum: number = 10;
  rowNum: number = 7;
  squareSize: number = 1;
  objp: number[][] = [];
  anglesHist: Point[] = [];
  objectPoints: number[][][] = [];
  imagePoints: number[][] = [];
  captured: number = 0;
  fps: number;
  lastDrawTime: number = 0;

  constructor(config: CameraConfig) {
    this.devices = [];
    this.selectedDeviceId = "";
    this.onError = config.onError;
    this.onReady = config.onReady;
    this.video = document.createElement("video");
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    this.stream = undefined;
    this.canvas = config.canvas;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.fps = config.fps || 10;
  }

  prepareObjectPoints() {
    const objp = [];
    for (let i = 0; i < this.rowNum; i++) {
      for (let j = 0; j < this.colNum; j++) {
        objp.push([j * this.squareSize, i * this.squareSize, 0]);
      }
    }
    return objp;
  }

  set blockConfig(config: BlockConfig) {
    this.colNum = config.colNum || this.colNum;
    this.rowNum = config.rowNum || this.rowNum;
    this.squareSize = config.squareSize || this.squareSize;
    this.objp = this.prepareObjectPoints();
  }

  async init() {
    await this.getDevicesWithPermission();
    await this.startCamera();
  }

  async getDevicesWithPermission() {
    //请求用户权限
    try {
      // 先请求权限
      await navigator.mediaDevices.getUserMedia({ video: true });
      // 再获取设备信息
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === "videoinput");
      this.devices = videoDevices;
      if (videoDevices.length > 0) {
        this.selectedDeviceId = videoDevices[0].deviceId;
      } else {
        this.onError?.("未找到摄像头设备");
      }
    } catch (error) {
      console.error(error);
      this.onError?.("无法获取摄像头设备");
    }
  }

  async startCamera() {
    // 打开相机
    this.onReady?.(false);
    this.stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: this.selectedDeviceId! } },
      });
      this.stream = stream;
      if (this.video) {
        this.video.srcObject = stream;
        this.video.addEventListener("canplay", () => {
          this.video.play();
        });
      }
      this.onReady?.(true);
    } catch (error) {
      console.error(error);
      this.onError?.("无法打开摄像头");
    }
  }

  stopStream() {
    this.stream?.getTracks().forEach((track) => track.stop());
  }

  // 角度分析函数
  analyzePose(rvec: OpenCV.Mat, tvec: OpenCV.Mat) {
    // rvec: 旋转向量
    // tvec: 平移向量
    // 旋转向量转欧拉角
    const rotMat = new cv.Mat();
    cv.Rodrigues(rvec, rotMat);
    // 取旋转矩阵
    // 欧拉角（假设摄像头坐标系，z轴朝前，x右，y下）
    // pitch: rotMat.data64F[7] = -rotMat.at(2,1)
    // yaw:   rotMat.data64F[6] = rotMat.at(2,0)
    // roll:  rotMat.data64F[3] = rotMat.at(1,0)
    // 这里用简单近似
    const sy = Math.sqrt(
      rotMat.data64F[0] * rotMat.data64F[0] +
        rotMat.data64F[3] * rotMat.data64F[3]
    );
    const singular = sy < 1e-6;
    let x, y, z;
    if (!singular) {
      x = Math.atan2(rotMat.data64F[7], rotMat.data64F[8]); // pitch
      y = Math.atan2(-rotMat.data64F[6], sy); // yaw
      z = Math.atan2(rotMat.data64F[3], rotMat.data64F[0]); // roll
    } else {
      x = Math.atan2(-rotMat.data64F[5], rotMat.data64F[4]);
      y = Math.atan2(-rotMat.data64F[6], sy);
      z = 0;
    }
    rotMat.delete();

    // tvec: 距离
    const distance = Math.sqrt(
      tvec.data64F[0] ** 2 + tvec.data64F[1] ** 2 + tvec.data64F[2] ** 2
    );

    // 返回角度（度）
    return {
      pitch: (x * 180) / Math.PI,
      yaw: (y * 180) / Math.PI,
      roll: (z * 180) / Math.PI,
      distance,
    };
  }

  // 指导建议函数
  getGuidance(newAngle: Point, history: Point[]) {
    // history: [{pitch, yaw, roll, ...}]
    // 计算与历史最大差值
    const threshold = 10; // 10度为“有意义的新角度”
    let maxPitchDiff = 0,
      maxYawDiff = 0,
      maxRollDiff = 0;
    for (const h of history) {
      maxPitchDiff = Math.max(maxPitchDiff, Math.abs(newAngle.pitch - h.pitch));
      maxYawDiff = Math.max(maxYawDiff, Math.abs(newAngle.yaw - h.yaw));
      maxRollDiff = Math.max(maxRollDiff, Math.abs(newAngle.roll - h.roll));
    }
    // 判断当前角度是否与历史接近，如果接近，建议移动
    if (maxPitchDiff < threshold) return "请上下移动相机或棋盘格";
    if (maxYawDiff < threshold) return "请左右移动相机或棋盘格";
    if (maxRollDiff < threshold) return "请旋转棋盘格或相机";
    return "当前角度合适，继续采集!";
  }

  draw() {
    if (this.video.videoHeight == 0 || this.video.videoWidth == 0) return;
    const now = performance.now();
    if (now - this.lastDrawTime < 1000 / this.fps) return;
    this.lastDrawTime = now;
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    
    this.ctx!.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    const src = cv.imread(this.canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const corners = new cv.Mat();
    const found = cv.findChessboardCornersSB(
      gray,
      new cv.Size(this.colNum, this.rowNum),
      corners,
      cv.CALIB_CB_NORMALIZE_IMAGE + cv.CALIB_CB_EXHAUSTIVE
    );

    // 3. 绘制角点
    if (found) {
      // 可以亚像素优化
      cv.cornerSubPix(
        gray,
        corners,
        new cv.Size(11, 11),
        new cv.Size(-1, -1),
        new cv.TermCriteria(
          cv.TermCriteria_EPS + cv.TermCriteria_MAX_ITER,
          30,
          0.001
        )
      );
      // 绘制
      for (let i = 0; i < corners.rows; i++) {
        const x = corners.data32F[i * 2];
        const y = corners.data32F[i * 2 + 1];
        // 用canvas画圈
        this.ctx!.beginPath();
        this.ctx!.arc(x, y, 5, 0, 2 * Math.PI);
        this.ctx!.fillStyle = "red";
        this.ctx!.fill();
      }

      // // 姿态估计
      // const objMat = cv.matFromArray(
      //   this.colNum * this.rowNum,
      //   1,
      //   cv.CV_32FC3,
      //   this.objp.flat()
      // );
      // const imgMat = cv.matFromArray(
      //   this.colNum * this.rowNum,
      //   1,
      //   cv.CV_32FC2,
      //   Array.from(corners.data32F)
      // );
      // const rvec = new cv.Mat();
      // const tvec = new cv.Mat();
      // // 若还没有标定，用初始值（常用 fx=fy=img.width, cx=img.width/2, cy=img.height/2），畸变为零
      // const { width, height } = gray.size();
      // const cameraMatrix = cv.matFromArray(3, 3, cv.CV_64FC1, [
      //   height,
      //   0,
      //   width / 2,
      //   0,
      //   height,
      //   height / 2,
      //   0,
      //   0,
      //   1,
      // ]);
      // const distCoeffs = cv.Mat.zeros(1, 5, cv.CV_64FC1);
      // cv.solvePnP(objMat, imgMat, cameraMatrix, distCoeffs, rvec, tvec);

      // // 分析角度
      // const angles = this.analyzePose(rvec, tvec);
      // // 给出建议
      // const tip = this.getGuidance(angles, this.anglesHist);
      // this.onGuidance?.(tip);

      // // 如果角度与历史差异大，才采集
      // if (tip === "当前角度合适，继续采集!") {
      //   this.objectPoints.push(this.objp);
      //   this.imagePoints.push(Array.from(corners.data32F));
      //   this.anglesHist.push(angles);
      //   this.captured++;
      // }
      // // 释放
      // objMat.delete();
      // imgMat.delete();
      // rvec.delete();
      // tvec.delete();
    }
    src.delete();
    gray.delete();
    corners.delete();
  }
}

export default Camera;
