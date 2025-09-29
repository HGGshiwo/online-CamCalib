import { useState, useCallback, useRef } from "react";
import cvReadyPromise from "@techstark/opencv-js";
import { Mat } from "@techstark/opencv-js";


type Point = {
    pitch: number,
    yaw: number,
    roll: number,
    distance: number
}
export function useCalibrationWithGuidance(capture: () => HTMLCanvasElement | null) {
    const [colNum, setColNum] = useState<number>(6)
    const [rowNum, setRowNum] = useState<number>(6)
    const [squareSize, setSqureSize] = useState<number>(1)
    const [guidance, setGuidance] = useState<string | null>(null);

    const cv = useRef<typeof cvReadyPromise>(null);
    const [anglesHistory, setAnglesHistory] = useState<Point[]>([]);

    // 构造棋盘格世界坐标
    const prepareObjectPoints = () => {
        const objp = [];
        for (let i = 0; i < rowNum; i++) {
            for (let j = 0; j < colNum; j++) {
                objp.push([j * squareSize, i * squareSize, 0]);
            }
        }
        return objp;
    };

    // 角度分析函数
    function analyzePose(rvec: Mat, tvec: Mat) {
        // rvec: 旋转向量
        // tvec: 平移向量
        // 旋转向量转欧拉角
        let rotMat = new Mat();
        cv.current!.Rodrigues(rvec, rotMat);
        // 取旋转矩阵
        // 欧拉角（假设摄像头坐标系，z轴朝前，x右，y下）
        // pitch: rotMat.data64F[7] = -rotMat.at(2,1)
        // yaw:   rotMat.data64F[6] = rotMat.at(2,0)
        // roll:  rotMat.data64F[3] = rotMat.at(1,0)
        // 这里用简单近似
        let sy = Math.sqrt(rotMat.data64F[0] * rotMat.data64F[0] + rotMat.data64F[3] * rotMat.data64F[3]);
        let singular = sy < 1e-6;
        let x, y, z;
        if (!singular) {
            x = Math.atan2(rotMat.data64F[7], rotMat.data64F[8]); // pitch
            y = Math.atan2(-rotMat.data64F[6], sy);               // yaw
            z = Math.atan2(rotMat.data64F[3], rotMat.data64F[0]); // roll
        } else {
            x = Math.atan2(-rotMat.data64F[5], rotMat.data64F[4]);
            y = Math.atan2(-rotMat.data64F[6], sy);
            z = 0;
        }
        rotMat.delete();

        // tvec: 距离
        const distance = Math.sqrt(tvec.data64F[0] ** 2 + tvec.data64F[1] ** 2 + tvec.data64F[2] ** 2);

        // 返回角度（度）
        return {
            pitch: x * 180 / Math.PI,
            yaw: y * 180 / Math.PI,
            roll: z * 180 / Math.PI,
            distance
        };
    }

    // 指导建议函数
    function getGuidance(newAngle: Point, history: Point[]) {
        // history: [{pitch, yaw, roll, ...}]
        // 计算与历史最大差值
        const threshold = 10; // 10度为“有意义的新角度”
        let maxPitchDiff = 0, maxYawDiff = 0, maxRollDiff = 0;
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

    // 标定采集流程
    const captureWithGuidance = useCallback(async (numImages = 15) => {
        cv.current = await cvReadyPromise;
        const objp = prepareObjectPoints();
        const objectPoints = [];
        const imagePoints = [];
        let anglesHist = [];

        for (let captured = 0; captured < numImages;) {
            // 抓帧
            const frame = capture()
            if(frame == null) continue;
            let mat = cv.current!.imread(frame);
            let gray = new cv.current!.Mat();
            cv.current!.cvtColor(mat, gray, cv.current!.COLOR_RGBA2GRAY);

            // 检测角点
            const patternSizeCv = new cv.current!.Size(colNum, rowNum);
            const corners = new cv.current!.Mat();
            const found = cv.current!.findChessboardCorners(gray, patternSizeCv, corners, cv.current!.CALIB_CB_ADAPTIVE_THRESH + cv.current!.CALIB_CB_NORMALIZE_IMAGE);
            const { width, height } = gray.size();
            if (found) {
                cv.current!.cornerSubPix(gray, corners, new cv.current!.Size(11, 11), new cv.current!.Size(-1, -1), new cv.current!.TermCriteria(cv.current!.TermCriteria_EPS + cv.current!.TermCriteria_MAX_ITER, 30, 0.001));
                // 姿态估计
                let objMat = cv.current!.matFromArray(colNum * rowNum, 1, cv.current!.CV_32FC3, objp.flat());
                let imgMat = cv.current!.matFromArray(colNum * rowNum, 1, cv.current!.CV_32FC2, Array.from(corners.data32F));
                let rvec = new cv.current!.Mat();
                let tvec = new cv.current!.Mat();
                // 若还没有标定，用初始值（常用 fx=fy=img.width, cx=img.width/2, cy=img.height/2），畸变为零
                let cameraMatrix, distCoeffs;
                cameraMatrix = cv.current!.matFromArray(3, 3, cv.current!.CV_64FC1, [
                    height, 0, width / 2,
                    0, height, height / 2,
                    0, 0, 1
                ]);
                distCoeffs = cv.current!.Mat.zeros(1, 5, cv.current!.CV_64FC1);
                cv.current!.solvePnP(objMat, imgMat, cameraMatrix, distCoeffs, rvec, tvec);

                // 分析角度
                const angles = analyzePose(rvec, tvec);
                // 给出建议
                const tip = getGuidance(angles, anglesHist);
                setGuidance(tip);

                // 如果角度与历史差异大，才采集
                if (tip === "当前角度合适，继续采集!") {
                    objectPoints.push(objp);
                    imagePoints.push(Array.from(corners.data32F));
                    anglesHist.push(angles);
                    setAnglesHistory([...anglesHist]);
                    captured++;
                }

                // 释放
                objMat.delete(); imgMat.delete(); rvec.delete(); tvec.delete();
            }
            mat.delete(); gray.delete(); corners.delete();

            await new Promise(res => setTimeout(res, 500));
        }
        // ...后续标定流程
        setGuidance("采集完成，开始标定！");
        // ...标定代码略
    }, [capture]);

    return { anglesHistory, captureWithGuidance, colNum, setColNum, rowNum, setRowNum, squareSize, setSqureSize, guidance };
}
