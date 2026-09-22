/** 服务端英文目录：键＝中文原文（docs/PLAN-I18N.md） */
import { rest } from "./en/rest.ts";
import { server } from "./en/server.ts";

export const en: Record<string, string> = { ...rest, ...server };
