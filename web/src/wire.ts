/** wire 协议类型：单一事实源在 server/wire.ts，此处仅类型再导出（构建期擦除） */
export type {
	ClientFrame,
	RpPanel,
	ServerFrame,
	WireActivity,
	WireChannel,
	WireChoice,
	WireMsg,
	WireSessionInfo,
	WireStats,
	WireSwipe,
	WorldState,
} from "../../server/wire.ts";
