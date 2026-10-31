/**
 * 三档程序卡运行时垫片（对照酒馆助手 JS-Slash-Runner 公开调用面的最小子集）。
 *
 * 设计纪律（docs card-frontend §6/§8）：
 * - 读族/存在性：先给桩，保证卡初始化不炸
 * - 生成族 / 斜杠：可接到梨园聊天总线（App 注册 bridge）
 * - 写正文：不提供
 *
 * 卡实际调用面：
 * - parent.TavernHelper.generate / stopAllGeneration
 * - triggerSlash(`/send …|/trigger`)  ← 某卡 开场表单
 * - eventOn / eventEmit
 * - parent.TheaterAPI / handleTheaterAction
 */

import { isCardRuntimeSource } from "./cardRuntimeFrames.ts";

export type TavernGenerateParams = {
	user_input?: string;
	should_stream?: boolean;
	disable_extras?: boolean;
	[k: string]: unknown;
};

/** App 注册：把卡侧 slash / generate 接到输入框与 WS prompt */
export type TavernChatBridge = {
	/** 只填输入框，不发送 */
	setInput: (text: string) => void;
	/** 作为用户消息发送并触发生成（空串 = 发送当前输入框内容） */
	sendPrompt: (text: string) => void;
	/** 可选：执行梨园斜杠命令原文（如 /rewind） */
	runCommand?: (text: string) => void;
};

type BusMap = Map<string, Set<(...args: unknown[]) => void>>;

let chatBridge: TavernChatBridge | null = null;

export function registerTavernChatBridge(bridge: TavernChatBridge | null): void {
	chatBridge = bridge;
}

/**
 * 注册梨园自己的通知条给作者脚本的 `toastr` 用（子帧经 `parent.__liyuanToast` 调）。
 * 传 null 注销。挂 window 而不是模块变量：iframe 与 server 各持一份 src 实例，
 * 模块级状态跨边界不可见（jiti 模块二象性的老坑），跨帧共享的东西必须挂 globalThis。
 * 档位用梨园自己的三档（toastr 的 success 在垫片里已折成 info），父页不再做映射。
 */
export type LiyuanToastLevel = "info" | "warning" | "error";

export function registerLiyuanToast(fn: ((level: LiyuanToastLevel, text: string) => void) | null): void {
	if (typeof window === "undefined") return;
	const w = window as Window & { __liyuanToast?: (level: LiyuanToastLevel, text: string) => void };
	if (fn) w.__liyuanToast = fn;
	else delete w.__liyuanToast;
}

function getBus(target: object): BusMap {
	const w = target as { __liyuanEventBus?: BusMap };
	if (!w.__liyuanEventBus) w.__liyuanEventBus = new Map();
	return w.__liyuanEventBus;
}

/** 挂 eventOn / eventEmit（iframe 内与父页各一份即可） */
export function installEventBus(target: object = typeof window !== "undefined" ? window : {}): void {
	const t = target as {
		eventOn?: (name: string, cb: (...args: unknown[]) => void) => void;
		eventEmit?: (name: string, ...args: unknown[]) => void;
	};
	if (typeof t.eventOn === "function" && typeof t.eventEmit === "function") return;

	const bus = getBus(target);
	t.eventOn = (name, cb) => {
		if (!bus.has(name)) bus.set(name, new Set());
		bus.get(name)!.add(cb);
	};
	t.eventEmit = (name, ...args) => {
		const set = bus.get(name);
		if (!set) return;
		for (const cb of set) {
			try {
				cb(...args);
			} catch (e) {
				console.error("[liyuan eventEmit]", name, e);
			}
		}
	};
}

/**
 * 解析酒馆式管道斜杠：`/send 文本|/trigger`
 * 分段以 `|` 分隔（ST STscript 同款）。
 */
export function parseSlashPipeline(raw: string): string[] {
	return String(raw ?? "")
		.split("|")
		.map((s) => s.trim())
		.filter(Boolean);
}

export type SlashExecResult = {
	ok: boolean;
	/** 已填入输入框或已发送的正文 */
	text?: string;
	/** 是否触发了生成 */
	triggered?: boolean;
	/** 仅填入输入框未发送 */
	filledOnly?: boolean;
	error?: string;
};

/**
 * 执行 triggerSlash 命令串（纯逻辑，可测）。
 * 支持：/send、/trigger，以及二者管道组合。
 */
export function executeTriggerSlash(
	raw: string,
	bridge: TavernChatBridge | null,
): SlashExecResult {
	if (!bridge) {
		return { ok: false, error: "聊天桥未就绪（App 未注册 TavernChatBridge）" };
	}
	const parts = parseSlashPipeline(raw);
	if (!parts.length) return { ok: false, error: "空命令" };

	let pendingSend = "";
	let wantTrigger = false;
	let filledOnly = false;

	for (const part of parts) {
		const cmd = part.startsWith("/") ? part : `/${part}`;
		const mSend = cmd.match(/^\/send(?:as)?(?:\s+name=[^\s]+)?\s*([\s\S]*)$/i);
		if (mSend) {
			pendingSend = (mSend[1] ?? "").trim();
			continue;
		}
		if (/^\/trigger\b/i.test(cmd)) {
			wantTrigger = true;
			continue;
		}
		// 其它斜杠：尽量当梨园命令
		if (cmd.startsWith("/") && bridge.runCommand) {
			try {
				bridge.runCommand(cmd);
			} catch (e) {
				console.warn("[liyuan triggerSlash] runCommand", cmd, e);
			}
			continue;
		}
		console.warn("[liyuan triggerSlash] 未识别命令", cmd);
	}

	if (wantTrigger) {
		// /send X|/trigger → 直接发 X 并生成；仅 /trigger → 发当前输入框
		const text = pendingSend;
		try {
			bridge.sendPrompt(text);
			return { ok: true, text, triggered: true };
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	if (pendingSend) {
		try {
			bridge.setInput(pendingSend);
			filledOnly = true;
			return { ok: true, text: pendingSend, filledOnly };
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	return { ok: true };
}

/** 父页全局 triggerSlash（iframe 通过 parent 或 postMessage 调用） */
export async function triggerSlash(raw: string): Promise<string> {
	const r = executeTriggerSlash(raw, chatBridge);
	if (!r.ok) {
		console.warn("[liyuan triggerSlash]", r.error, raw?.slice?.(0, 80));
		return r.error || "";
	}
	return r.text || "";
}

/** 父页安装：卡脚本通过 window.parent.TavernHelper / triggerSlash 访问 */
export function installParentTavernShim(): void {
	if (typeof window === "undefined") return;
	const w = window as Window & {
		__liyuanTavernShimInstalled?: boolean;
		TavernHelper?: {
			generate: (params?: TavernGenerateParams) => Promise<string>;
			stopAllGeneration: () => void;
		};
		TheaterAPI?: { call: (method: string, ...args: unknown[]) => Promise<unknown> };
		handleTheaterAction?: (msg: unknown) => void;
		triggerSlash?: (cmd: string) => Promise<string> | string;
	};
	if (w.__liyuanTavernShimInstalled) return;
	w.__liyuanTavernShimInstalled = true;

	installEventBus(w);

	w.triggerSlash = (cmd: string) => triggerSlash(cmd);

	// iframe 无 same-origin 时走 postMessage（测试桩可能没有 addEventListener）
	if (typeof window.addEventListener === "function") {
		window.addEventListener("message", (ev: MessageEvent) => {
			const d = ev.data as { liyuanTriggerSlash?: unknown } | null;
			if (!d || typeof d.liyuanTriggerSlash !== "string" || !isCardRuntimeSource(ev.source)) return;
			void triggerSlash(d.liyuanTriggerSlash);
		});
	}

	w.TavernHelper = {
		/**
		 * 对照卡内：await generate({ user_input, should_stream }) → string
		 * 已注册 bridge 时：把 user_input 当用户发言并触发生成。
		 */
		async generate(params) {
			const input = String(params?.user_input ?? "").trim();
			if (chatBridge && input) {
				try {
					chatBridge.sendPrompt(input);
					return input;
				} catch (e) {
					console.warn("[liyuan TavernHelper.generate]", e);
				}
			}
			console.warn("[liyuan TavernHelper.generate] 无 bridge 或空输入", {
				len: input.length,
				stream: params?.should_stream,
			});
			return `（梨园：界面内 AI 生成未接入聊天桥。输入：${input.slice(0, 80) || "（空）"}）`;
		},
		stopAllGeneration() {
			console.warn("[liyuan TavernHelper.stopAllGeneration] no-op");
		},
	};

	w.TheaterAPI = {
		async call(method, ...args) {
			console.warn("[liyuan TheaterAPI.call]", method, args?.length ?? 0);
			return null;
		},
	};

	w.handleTheaterAction = (msg) => {
		console.warn("[liyuan handleTheaterAction]", msg);
	};
}

/**
 * 注入到脚本帧 head 最前：同源下挂 TavernHelper + triggerSlash；
 * 并尽量镜像 parent（双保险）；跨域则 postMessage。
 */
export const IFRAME_TAVERN_BRIDGE_SNIPPET = `<script>(function(){
try{
  var g=typeof window!=="undefined"?window:null;if(!g)return;
  function bus(){if(!g.__liyuanEventBus)g.__liyuanEventBus=new Map();return g.__liyuanEventBus;}
  if(typeof g.eventOn!=="function"){
    g.eventOn=function(name,cb){var b=bus();if(!b.has(name))b.set(name,new Set());b.get(name).add(cb);};
  }
  if(typeof g.eventEmit!=="function"){
    g.eventEmit=function(name){var args=[].slice.call(arguments,1),b=bus(),s=b.get(name);if(!s)return;
      s.forEach(function(cb){try{cb.apply(null,args);}catch(e){console.error(e);}});};
  }
  function parentWin(){try{return g.parent&&g.parent!==g?g.parent:null;}catch(e){return null;}}
  function parentTH(){var p=parentWin();return p&&p.TavernHelper?p.TavernHelper:null;}
  if(typeof g.triggerSlash!=="function"){
    g.triggerSlash=function(cmd){
      var p=parentWin();
      try{
        if(p&&typeof p.triggerSlash==="function"){
          var r=p.triggerSlash(cmd);
          return r&&typeof r.then==="function"?r:Promise.resolve(r);
        }
      }catch(e){}
      try{if(p)p.postMessage({liyuanTriggerSlash:String(cmd||"")},"*");}catch(e2){}
      return Promise.resolve("");
    };
  }
  if(!g.TavernHelper){
    g.TavernHelper={
      generate:function(params){
        var p=parentTH();
        if(p&&typeof p.generate==="function")return p.generate(params);
        console.warn("[liyuan iframe] TavernHelper.generate stub");
        var u=(params&&params.user_input)||"";
        return Promise.resolve("（梨园：界面内 AI 生成尚未接入）"+String(u).slice(0,80));
      },
      stopAllGeneration:function(){
        var p=parentTH();
        if(p&&typeof p.stopAllGeneration==="function")return p.stopAllGeneration();
      }
    };
  }
  try{
    if(g.parent&&g.parent.TheaterAPI)g.TheaterAPI=g.parent.TheaterAPI;
    else if(!g.TheaterAPI)g.TheaterAPI={call:function(){return Promise.resolve(null);}};
  }catch(e){}
  try{
    if(g.parent&&typeof g.parent.handleTheaterAction==="function"){
      g.handleTheaterAction=function(m){return g.parent.handleTheaterAction(m);};
    }
  }catch(e){}
}catch(e){console.error("[liyuan bridge]",e);}
})();</script>`;

import { JQUERY_MIN } from "./vendor/jquery-min.ts";

/**
 * 酒馆全局垫片（脚本帧专用，注入在 bridge 之后、卡脚本之前）。
 *
 * 酒馆页面内置 jQuery/lodash/变量系统/MVU 插件对象，卡界面脚本直接裸用这些全局
 * （实测一张卡的状态栏 UI 就裸用了 30 处 `$`、`_.get`、`getAllVariables()`、`Mvu`/`eventOn`）——
 * 梨园 srcdoc 沙箱里没有这些，脚本第一行就 ReferenceError，按钮事件永远绑不上
 * （8/05 实弹：状态栏出来了但页签全点不动）。
 *
 * 垫片面（对照酒馆公开调用面）：
 * - `$`/`jQuery`：完整 jQuery 3.7.1（离线内置，MIT）
 * - `_`：lodash 常用子集（get/set/has/each/isArray/isObject/escape 等，按需扩充）
 * - `getAllVariables()` / `getVariables()`：酒馆变量系统 → 梨园侧变量 JSON（默认空壳 `{stat_data:{}}`，
 *   父页可 postMessage {liyuanVariables} 注入——后续接梨园账本）
 * - `errorCatched(fn)`：包装函数、报错走 console、功能照跑（返回可调用体）
 * - `substitudeMacros`/`getLastMessageId`/`getChatMessages`：util/读族安全降级
 * - `Mvu`：MVU 插件对象壳（事件常量 + 空事件总线，数据刷新联动后置）
 * - `waitGlobalInitialized(name)`：酒馆等待全局就绪 → 目标已存在立即 resolve
 *
 * 覆盖的是酒馆助手**已发布的调用面**（公开 `.d.ts`）中卡会裸用的读/util 子集，非枚举卡作者措辞
 * （Wine 式兼容面，spec §3 原则 4）。
 *
 * **写族的边界**（8/26 补页面级脚本宿主时划定）：变量写入按**作用域**分家，不是一刀切禁。
 * `global`/`script` 作用域是作者脚本自己的界面自留地（实测页面级 UI 脚本的全部写入就是存
 * 悬浮球坐标，chat/message 作用域 0 次），落 localStorage；`chat`/`message`（＝梨园账本）
 * 写入一律拒绝并 warn。正文红线未松动：界面递条子、不拧旋钮，剧情状态只由 agent/场记推动。
 */
export const IFRAME_TAVERN_GLOBALS_SNIPPET = `<script>(function(){
var g=typeof window!=="undefined"?window:null;if(!g)return;
try{
  if(typeof g.jQuery!=="function"){
    ${JQUERY_MIN}
  }
  if(!g._||typeof g._!=="object"){
    function lp(obj,path){if(path==null)return obj;if(!Array.isArray(path))path=String(path).split(".");var o=obj;for(var i=0;i<path.length;i++){if(o==null)return undefined;o=o[path[i]];}return o;}
    g._={
      get:function(obj,path,def){var v=lp(obj,path);return v===undefined?def:v;},
      set:function(obj,path,val){if(path==null)return obj;if(!Array.isArray(path))path=String(path).split(".");var o=obj;for(var i=0;i<path.length-1;i++){if(o[path[i]]==null||typeof o[path[i]]!=="object")o[path[i]]={};o=o[path[i]];}o[path[path.length-1]]=val;return obj;},
      has:function(obj,path){return lp(obj,path)!==undefined;},
      each:function(coll,fn){if(Array.isArray(coll)){for(var i=0;i<coll.length;i++){if(fn(coll[i],i)===false)break;}}else{for(var k in coll){if(Object.prototype.hasOwnProperty.call(coll,k)){if(fn(coll[k],k)===false)break;}}}return coll;},
      forEach:function(coll,fn){return g._.each(coll,fn);},
      isArray:function(v){return Array.isArray(v);},
      isObject:function(v){return v!=null&&typeof v==="object"&&!Array.isArray(v);},
      isString:function(v){return typeof v==="string";},
      isNumber:function(v){return typeof v==="number"&&isFinite(v);},
      isBoolean:function(v){return typeof v==="boolean";},
      isFunction:function(v){return typeof v==="function";},
      isEmpty:function(v){if(v==null)return true;if(Array.isArray(v)||typeof v==="string")return v.length===0;if(typeof v==="object")return Object.keys(v).length===0;return false;},
      escape:function(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});},
      unescape:function(s){return String(s==null?"":s).replace(/&(?:amp|lt|gt|quot|#39);/g,function(m){return {"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&#39;":"'"}[m];});},
      clone:function(v){if(v==null||typeof v!=="object")return v;return JSON.parse(JSON.stringify(v));},
      debounce:function(fn,wait){var t=null;return function(){var a=arguments,c=this;clearTimeout(t);t=setTimeout(function(){fn.apply(c,a);},wait||100);};},
      now:function(){return Date.now();}
    };
  }
  if(typeof g.getAllVariables!=="function"){
    g.getAllVariables=function(){
      var v=g.__liyuanVariables||null;
      if(!v){
        try{
          var p=(g.parent&&g.parent!==g)?g.parent:null;
          if(p&&p.__liyuanVariables&&typeof p.__liyuanVariables==="object"){
            v=p.__liyuanVariables;
            g.__liyuanVariables=v;
          }
        }catch(e){}
      }
      return v&&typeof v==="object"?v:{stat_data:{}};
    };
  }
  // 父页把梨园账本的 MVU 树 postMessage 进来 → 写 window.__liyuanVariables（getAllVariables 的数据源）。
  // 卡脚本多用 setInterval 轮询 getAllVariables 自行重画（实测有卡是 1.5s 一轮），故收到即生效、无需重载；
  // 另发一次 Mvu 的 VARIABLE_UPDATE_ENDED 事件，兼顾监听事件而非轮询的卡。父→子单向通道，非模型注入。
  if(typeof g.addEventListener==="function"){
    g.addEventListener("message",function(ev){
      var d=ev&&ev.data;
      if(!d||typeof d!=="object"||!("liyuanVariables" in d))return;
      var v=d.liyuanVariables;
      g.__liyuanVariables=(v&&typeof v==="object")?v:{stat_data:{}};
      if(g.Mvu&&g.Mvu.events&&typeof g.eventEmit==="function"){
        try{g.eventEmit(g.Mvu.events.VARIABLE_UPDATE_ENDED,g.__liyuanVariables);}catch(e){}
      }
    });
    // boot 后主动要一次当前变量（本帧可能是刚滚进视口才建、错过了父页上一次广播）
    try{var pv=(g.parent&&g.parent!==g)?g.parent:null;if(pv)pv.postMessage({liyuanVariablesReady:g.name||1},"*");}catch(e){}
  }
  // 酒馆助手 util/读族裸全局（对照公开类型声明 @types/function、@types/iframe/variables）。
  // 卡把它们当裸全局直接调用；module 脚本下缺一个就是 ReferenceError → 整份界面初始化中断
  // （8/25 实测：唯一缺的 errorCatched 让 $(errorCatched(init)) 抛错，5 个页签全点不动）。
  // 全部安全降级：读族回空、util 按语义。写族/生成族不在此列（正文红线：界面不得拧旋钮）。
  if(typeof g.errorCatched!=="function"){
    // 公开语义：包装函数，报错时提示、功能照跑。返回值必须可调用（$(errorCatched(init)) 依赖它）。
    g.errorCatched=function(fn){
      if(typeof fn!=="function")return fn;
      return function(){try{return fn.apply(this,arguments);}catch(e){console.error("[liyuan card]",e);}};
    };
  }
  if(typeof g.getVariables!=="function"){
    g.getVariables=function(opts){
      var t=opts&&opts.type;
      if(t==="global"||t==="script")return g.__liyuanAuthorVarsRead(t);
      return g.getAllVariables();
    };
  }
  // 作者脚本的「界面自留地」——与梨园账本严格分家。
  //
  // 实测三个页面级 UI 脚本的全部写入合起来只有一件事：把自己的坐标存下来
  // （insertOrAssignVariables({xxx_pos:"{x,y}"},{type:'global'})），
  // chat/message 作用域出现 0 次。所以「让球记住位置」和「让界面拧账本」是两件事，
  // 不必为了前者放开后者：
  // - global/script 作用域 = 纯前端 UI 状态 → 落 localStorage（本机、本浏览器）
  // - 其余（含缺省、chat、message）= 梨园账本 → **读可以，写一律拒绝**
  // 账本只由 agent 与场记推动，界面递条子不拧旋钮（本文件头的红线，未松动）。
  if(typeof g.__liyuanAuthorVarsRead!=="function"){
    var AV_KEY=function(t){return "liyuan.authorVars."+(t==="script"?"script":"global");};
    g.__liyuanAuthorVarsRead=function(t){
      try{
        var raw=g.localStorage&&g.localStorage.getItem(AV_KEY(t));
        var v=raw?JSON.parse(raw):null;
        return v&&typeof v==="object"?v:{};
      }catch(e){return {};}
    };
    g.__liyuanAuthorVarsWrite=function(t,patch,mode){
      try{
        var cur=mode==="replace"?{}:g.__liyuanAuthorVarsRead(t);
        for(var k in patch){if(Object.prototype.hasOwnProperty.call(patch,k))cur[k]=patch[k];}
        if(g.localStorage)g.localStorage.setItem(AV_KEY(t),JSON.stringify(cur));
        return cur;
      }catch(e){return {};}
    };
    // 三个写族入口同一套语义（酒馆助手公开面：insertOrAssign 合并 / replace 整替 / updateWith 函数式）
    var authorWrite=function(name,mode){
      return function(arg,opts){
        var t=opts&&opts.type;
        if(t!=="global"&&t!=="script"){
          console.warn("[liyuan "+name+"] 梨园账本只读：界面不拧旋钮，剧情状态由 agent/场记推动。作用域="+String(t||"(缺省)"));
          return Promise.resolve({});
        }
        var patch=arg;
        if(typeof arg==="function"){
          try{patch=arg(g.__liyuanAuthorVarsRead(t))||{};}catch(e){patch={};}
        }
        if(!patch||typeof patch!=="object")return Promise.resolve({});
        return Promise.resolve(g.__liyuanAuthorVarsWrite(t,patch,mode));
      };
    };
    if(typeof g.insertOrAssignVariables!=="function")g.insertOrAssignVariables=authorWrite("insertOrAssignVariables","assign");
    if(typeof g.replaceVariables!=="function")g.replaceVariables=authorWrite("replaceVariables","replace");
    if(typeof g.updateVariablesWith!=="function")g.updateVariablesWith=authorWrite("updateVariablesWith","assign");
  }
  // toastr：作者脚本拿它当唯一反馈渠道（一个脚本里 58 处）。接梨园自己的通知条，
  // 接不上就退回 console——缺这个全局同样是 ReferenceError（同 errorCatched 那个坑）。
  if(!g.toastr){
    var toast=function(level){
      return function(msg,title){
        var text=String(title?title+"：":"")+String(msg==null?"":msg);
        try{
          var p=(g.parent&&g.parent!==g)?g.parent:null;
          if(p&&typeof p.__liyuanToast==="function"){p.__liyuanToast(level,text);return;}
        }catch(e){}
        console.log("[liyuan toastr:"+level+"]",text);
      };
    };
    g.toastr={success:toast("info"),info:toast("info"),warning:toast("warning"),error:toast("error")};
  }
  if(typeof g.substitudeMacros!=="function"){
    g.substitudeMacros=function(text){return text==null?"":String(text);};
  }
  if(typeof g.getLastMessageId!=="function"){
    g.getLastMessageId=function(){return 0;};
  }
  if(typeof g.getCurrentMessageId!=="function"){
    g.getCurrentMessageId=function(){return 0;};
  }
  if(typeof g.getChatMessages!=="function"){
    g.getChatMessages=function(){
      var d=g.getAllVariables();
      return [{message_id:0,message:"",mes:"",data:d,variables:d}];
    };
  }
  if(!g.Mvu){
    g.Mvu={
      isMvuEnabled:true,
      events:{
        VARIABLE_UPDATE_STARTED:"VARIABLE_UPDATE_STARTED",
        VARIABLE_UPDATE_ENDED:"VARIABLE_UPDATE_ENDED",
        VARIABLE_UPDATE_FAILED:"VARIABLE_UPDATE_FAILED"
      },
      state:{},
      getMvuData:function(){return g.getAllVariables();},
      setMvuVariable:function(mvuData,path,val){
        try{if(mvuData&&mvuData.stat_data&&g._)g._.set(mvuData.stat_data,path,val);}catch(e){}
        return Promise.resolve(true);
      },
      replaceMvuData:function(data){
        if(data&&typeof data==="object")g.__liyuanVariables=data;
        return Promise.resolve(data);
      },
      parseMessage:function(_cmd,oldData){
        return Promise.resolve(oldData||g.getAllVariables());
      }
    };
  }
  if(typeof g.waitGlobalInitialized!=="function"){
    g.waitGlobalInitialized=function(name,timeoutMs){
      return new Promise(function(res){
        var t0=Date.now(),lim=timeoutMs||5000;
        (function poll(){
          try{if(g[name])return res(true);}catch(e){return res(false);}
          if(Date.now()-t0>lim)return res(false);
          setTimeout(poll,50);
        })();
      });
    };
  }
}catch(e){console.error("[liyuan globals]",e);}
})();</script>`;
