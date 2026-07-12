/**
 * WS 客户端：同源 /ws，断线自动重连（1.5s 起指数退避，封顶 10s）。
 * 只负责连接与帧收发，状态归 App。
 */

import { useEffect, useRef } from "react";
import type { ClientFrame, ServerFrame } from "./wire.ts";

export type ConnState = "connecting" | "open" | "closed";

export interface WsHandle {
	send: (frame: ClientFrame) => void;
}

export function useWire(onFrame: (frame: ServerFrame) => void, onState: (s: ConnState) => void): WsHandle {
	const wsRef = useRef<WebSocket | null>(null);
	const onFrameRef = useRef(onFrame);
	const onStateRef = useRef(onState);
	onFrameRef.current = onFrame;
	onStateRef.current = onState;

	useEffect(() => {
		let closed = false;
		let retryMs = 1500;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const connect = () => {
			if (closed) return;
			onStateRef.current("connecting");
			const proto = location.protocol === "https:" ? "wss:" : "ws:";
			const ws = new WebSocket(`${proto}//${location.host}/ws`);
			wsRef.current = ws;

			ws.onopen = () => {
				retryMs = 1500;
				onStateRef.current("open");
			};
			ws.onmessage = (ev) => {
				try {
					onFrameRef.current(JSON.parse(String(ev.data)) as ServerFrame);
				} catch {
					// 非 JSON 帧忽略
				}
			};
			ws.onclose = () => {
				if (closed) return;
				onStateRef.current("closed");
				timer = setTimeout(connect, retryMs);
				retryMs = Math.min(retryMs * 2, 10_000);
			};
			ws.onerror = () => ws.close();
		};

		connect();
		return () => {
			closed = true;
			if (timer) clearTimeout(timer);
			wsRef.current?.close();
		};
	}, []);

	return {
		send: (frame) => {
			const ws = wsRef.current;
			if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
		},
	};
}
