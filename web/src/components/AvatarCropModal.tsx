/**
 * ST 式头像裁剪：选图 → 方形视口内拖移/缩放 → 导出 256² PNG。
 * 无第三方依赖，canvas 完成。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { IconClose } from "./icons.tsx";

const VIEW = 280; // 预览视口边长
const OUT = 256; // 导出边长

export function AvatarCropModal({
	file,
	onCancel,
	onConfirm,
	busy,
}: {
	file: File;
	onCancel: () => void;
	onConfirm: (blob: Blob) => void;
	busy?: boolean;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const imgRef = useRef<HTMLImageElement | null>(null);
	const [ready, setReady] = useState(false);
	const [scale, setScale] = useState(1);
	const [minScale, setMinScale] = useState(0.2);
	const [offset, setOffset] = useState({ x: 0, y: 0 });
	const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
	const objectUrl = useRef<string | null>(null);

	const paint = useCallback(() => {
		const canvas = canvasRef.current;
		const img = imgRef.current;
		if (!canvas || !img) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = VIEW * dpr;
		canvas.height = VIEW * dpr;
		canvas.style.width = `${VIEW}px`;
		canvas.style.height = `${VIEW}px`;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = "#1c1917";
		ctx.fillRect(0, 0, VIEW, VIEW);
		const w = img.naturalWidth * scale;
		const h = img.naturalHeight * scale;
		const x = (VIEW - w) / 2 + offset.x;
		const y = (VIEW - h) / 2 + offset.y;
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.drawImage(img, x, y, w, h);
		// 圆形遮罩提示（ST 头像多为圆）
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, VIEW, VIEW);
		ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 1, 0, Math.PI * 2, true);
		ctx.fillStyle = "rgba(33, 30, 27, 0.45)";
		ctx.fill();
		ctx.restore();
		ctx.strokeStyle = "rgba(255,255,255,0.85)";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 2, 0, Math.PI * 2);
		ctx.stroke();
	}, [offset.x, offset.y, scale]);

	useEffect(() => {
		const url = URL.createObjectURL(file);
		objectUrl.current = url;
		const img = new Image();
		img.onload = () => {
			imgRef.current = img;
			// 初始缩放：短边盖满视口
			const fit = Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight);
			setMinScale(fit * 0.5);
			setScale(fit);
			setOffset({ x: 0, y: 0 });
			setReady(true);
		};
		img.onerror = () => setReady(false);
		img.src = url;
		return () => {
			URL.revokeObjectURL(url);
			objectUrl.current = null;
			imgRef.current = null;
		};
	}, [file]);

	useEffect(() => {
		if (ready) paint();
	}, [ready, paint]);

	const onPointerDown = (e: React.PointerEvent) => {
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
	};
	const onPointerMove = (e: React.PointerEvent) => {
		if (!drag.current) return;
		setOffset({
			x: drag.current.ox + (e.clientX - drag.current.x),
			y: drag.current.oy + (e.clientY - drag.current.y),
		});
	};
	const onPointerUp = () => {
		drag.current = null;
	};

	const exportBlob = () => {
		const img = imgRef.current;
		if (!img) return;
		const out = document.createElement("canvas");
		out.width = OUT;
		out.height = OUT;
		const ctx = out.getContext("2d");
		if (!ctx) return;
		// 视口坐标 → 原图像素：视口中心对应图上的点
		const w = img.naturalWidth * scale;
		const h = img.naturalHeight * scale;
		const x = (VIEW - w) / 2 + offset.x;
		const y = (VIEW - h) / 2 + offset.y;
		// 视口 (0,0)-(VIEW,VIEW) 映射到输出
		// drawImage 的源矩形：视口区域在图像上的覆盖
		const sx = (0 - x) / scale;
		const sy = (0 - y) / scale;
		const sw = VIEW / scale;
		const sh = VIEW / scale;
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT, OUT);
		out.toBlob(
			(blob) => {
				if (blob) onConfirm(blob);
			},
			"image/png",
			0.92,
		);
	};

	return (
		<div className="avatar-crop-modal" role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title">
			<div className="avatar-crop-dialog">
				<button type="button" className="icon-btn card-lore-x" title="取消" aria-label="关闭" onClick={onCancel} disabled={busy}>
					<IconClose size={18} />
				</button>
				<h3 id="avatar-crop-title">裁剪头像</h3>
				<p className="field-hint">拖动调整位置，滑块缩放；圆内区域将保存为头像（参考 SillyTavern）。</p>
				<div className="avatar-crop-stage">
					<canvas
						ref={canvasRef}
						className="avatar-crop-canvas"
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
						onPointerCancel={onPointerUp}
					/>
				</div>
				<label className="avatar-crop-zoom">
					<span>缩放</span>
					<input
						type="range"
						min={minScale}
						max={Math.max(minScale * 6, 3)}
						step={0.01}
						value={scale}
						disabled={!ready || busy}
						onChange={(e) => setScale(Number(e.target.value))}
					/>
				</label>
				<div className="panel-row card-lore-actions">
					<button type="button" className="drawer-btn save-btn" disabled={!ready || busy} onClick={exportBlob}>
						{busy ? "上传中…" : "用作头像"}
					</button>
					<button type="button" className="drawer-btn" disabled={busy} onClick={onCancel}>
						取消
					</button>
				</div>
			</div>
		</div>
	);
}
