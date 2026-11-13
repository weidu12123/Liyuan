/**
 * 页面级脚本宿主的 srcdoc（纯函数，供 ScriptHost 与测试）。
 *
 * 与 frameDoc 的分工：frameDoc 拼**消息级**帧（气泡内那份 HTML 界面），本文件拼
 * **页面级**帧（作者声明的运行时脚本）。两者共用同一份垫片与同一份 CSP，但定位相反——
 * 消息帧是要显示的内容，宿主帧自己不显示任何东西（0×0、隐藏），它的产物挂在**父页**。
 *
 * ## 为什么宿主帧必须是 iframe，而不是直接 eval 在梨园页面里
 * 1. **作者脚本就是写给这个形状的**：实测三个页面级 UI 脚本开头逐字都是
 *    `pdoc = (parent && parent.document) ? parent.document : document`——它们假定自己
 *    跑在一个子帧里、要跨一层去父页挂 DOM。酒馆助手就是这么跑的。直接在父页 eval，
 *    `parent` 是浏览器窗口本身，这段降级分支会把球挂到别处。
 * 2. **隔离炸弹**：一份 3.5MB 的作者脚本抛异常、死循环、污染全局，都关在帧里，
 *    梨园的 React 树不受影响；帧还能整个换掉（换卡即换帧）。
 * 3. **同源是必需的**：`sandbox` 必须带 `allow-same-origin`，否则 `parent.document`
 *    抛 SecurityError、脚本走降级分支把 UI 挂进这个 0×0 的帧里 = 用户什么也看不见。
 *
 * ## 作者代码不进 HTML
 * 载荷经 `parent.__liyuanAuthorScripts` 同源直读，再由加载器用 `textContent` 建
 * `<script>` 元素执行——**不拼进 srcdoc**。两个理由：
 * - 作者脚本里含字面量 `</script>`（拿模板串拼整页 HTML 的写法极常见），拼进 HTML
 *   会被解析器当场截断，frameDoc 为此专门写了个 JS 状态机（findScriptCloseIndex）。
 *   走 textContent 通道压根不经 HTML 解析，这类转义问题从根上不存在。
 * - 单份脚本实测可达 3.5MB，srcdoc 是个属性字符串，不该塞这个量级。
 */

import { IMPORT_MAP_SNIPPET, MVU_BUNDLE_DATA_URI, MVU_ZOD_DATA_URI, SCRIPT_FRAME_CSP } from "./frameDoc.ts";
import { IFRAME_TAVERN_BRIDGE_SNIPPET, IFRAME_TAVERN_GLOBALS_SNIPPET } from "./tavernShim.ts";

/** 父页挂载点：宿主帧同源直读这个全局取脚本（挂 window 而非模块变量，跨帧才看得见） */
export const AUTHOR_SCRIPTS_GLOBAL = "__liyuanAuthorScripts";

const LOADER_SNIPPET = `<script>(function(){
try{
  var g=window;
  var MVU_URI=${JSON.stringify(MVU_BUNDLE_DATA_URI)};
  var MVU_ZOD_URI=${JSON.stringify(MVU_ZOD_DATA_URI)};
  function parentWin(){try{return (g.parent&&g.parent!==g)?g.parent:null;}catch(e){return null;}}
  function readList(){
    try{ var p=parentWin(); return p?p["${AUTHOR_SCRIPTS_GLOBAL}"]:null; }catch(e){ return null; }
  }
  function rewriteBuiltinModuleUrls(code){
    return String(code||"")
      .replace(/https?:\\/\\/(?:testingcf|cdn|fastly|gcore)\\.jsdelivr\\.net\\/gh\\/MagicalAstrogy\\/MagVarUpdate(?:@[^/'"]+)?\\/artifact\\/bundle\\.js/g,MVU_URI)
      .replace(/\\x60https:\\/\\/\\$\\{[^}]+\\}\\/gh\\/MagicalAstrogy\\/MagVarUpdate(?:@[^/\\x60]+)?\\/artifact\\/bundle\\.js\\x60/g,JSON.stringify(MVU_URI))
      .replace(/https?:\\/\\/(?:testingcf|cdn|fastly|gcore)\\.jsdelivr\\.net\\/gh\\/StageDog\\/tavern_resource(?:@[^/'"]+)?\\/dist\\/util\\/mvu_zod\\.js/g,MVU_ZOD_URI);
  }
  function run(list){
    var ok=0,bad=0,mods=0;
    if(!g.__liyuanScriptRegistry)g.__liyuanScriptRegistry={};
    for(var i=0;i<list.length;i++){
      var item=list[i]||{};
      var sid=String(item.id||("card-"+i));
      var code=rewriteBuiltinModuleUrls(String(item.content||""));
      g.__liyuanScriptRegistry[sid]={
        id:sid,
        name:String(item.name||""),
        info:String(item.info||""),
        source:String(item.source||"card"),
        data:(item.data&&typeof item.data==="object")?JSON.parse(JSON.stringify(item.data)):{},
        button:(item.button&&typeof item.button==="object")?JSON.parse(JSON.stringify(item.button)):{enabled:true,buttons:[]}
      };
      if(!g.__liyuanDefaultScriptId)g.__liyuanDefaultScriptId=sid;
      g.__liyuanCurrentScriptId=sid;
      if(item.data&&typeof item.data==="object"&&typeof g.__liyuanSeedScriptVars==="function"){
        try{g.__liyuanSeedScriptVars(sid,item.data);}catch(e0){}
      }
      try{
        var el=document.createElement("script");
        el.setAttribute("data-liyuan-author-script",sid);
        el.type="module";
        mods++;
        el.textContent="window.__liyuanCurrentScriptId="+JSON.stringify(sid)+";\\n"+code;
        document.body.appendChild(el);
        ok++;
      }catch(e){ bad++; console.error("[liyuan scriptHost] 脚本执行失败",item&&item.name,e); }
    }
    try{
      var pw=parentWin();
      if(pw)pw.postMessage({liyuanScriptHostBooted:{ok:ok,failed:bad,total:list.length,modules:mods}},"*");
    }catch(e2){}
  }
  // 父页在渲染期就挂好了清单，正常一次就读到。轮询只是兜底（并发渲染/提交时序的意外），
  // 读到即跑、超时即算这张卡没脚本——不重试、不报错弹窗。
  var tries=0;
  (function poll(){
    var list=readList();
    if(list&&list.length)return run(list);
    if(++tries>60)return;
    setTimeout(poll,16);
  })();
}catch(e){console.error("[liyuan scriptHost loader]",e);}
})();</script>`;

/**
 * 宿主帧文档。自身不渲染任何内容（透明、零尺寸），只提供一个跑脚本的同源沙箱。
 * 垫片顺序与消息帧一致：importmap → bridge → globals → 加载器，保证 `$`/`errorCatched`/
 * `getAllVariables`/`Mvu`/`toastr`/`z`/`_` 在作者第一行代码前就位。
 */
export function buildScriptHostDoc(): string {
	return (
		`<!doctype html><html><head>` +
		`<meta charset="utf-8">` +
		`<meta http-equiv="Content-Security-Policy" content="${SCRIPT_FRAME_CSP}">` +
		`<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style>` +
		IMPORT_MAP_SNIPPET +
		IFRAME_TAVERN_BRIDGE_SNIPPET +
		IFRAME_TAVERN_GLOBALS_SNIPPET +
		`</head><body>` +
		`<div style="display:none">` +
		`<select id="world_info_sort_order"><option value="13">13</option></select>` +
		`<div id="extensions_settings"></div>` +
		`<div id="extensions_settings2"></div>` +
		`</div>` +
		LOADER_SNIPPET +
		`</body></html>`
	);
}

/** 宿主帧沙箱：same-origin 是硬需求（见文件头②③），其余对齐脚本型消息帧 */
export const SCRIPT_HOST_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-modals allow-popups";
