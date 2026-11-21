/** MimaTAVERN v1.3.7 built-in theme engine. */
(() => {
  'use strict';
  const root=typeof window!=='undefined'?window:globalThis;
  const BUILTINS=Object.freeze([
    {id:'default',name:'Mima Default',description:'咪嘛馆原始浅色玻璃主题'},
    {id:'midnight',name:'Midnight',description:'炭黑低眩光深色模式'},
    {id:'eink',name:'E-Ink',description:'灰纸深灰字、近零特效的电子墨水阅读模式'},
    {id:'paper',name:'Paper',description:'暖纸色长篇阅读主题'},
    {id:'seoul-mist',name:'Seoul Mist · 韩系灰白',description:'低饱和灰白、清爽极简与柔和线条'},
    {id:'sakura-milk',name:'Sakura Milk · 樱花粉',description:'淡樱花粉、奶油白与温柔莓果色'},
    {id:'lilac-cloud',name:'Lilac Cloud · 云朵淡紫',description:'奶白薰衣草紫、轻盈梦幻的柔雾主题'},
    {id:'aqua-sky',name:'Aqua Sky · 蓝白水色',description:'清透湖水蓝、白云与玻璃质感'},
    {id:'material-snow',name:'Material Snow · 谷歌系',description:'Material 风格的柔白卡片与四色点缀'},
    {id:'fluent-blue',name:'Fluent Blue · 微软系',description:'清澈蓝灰、柔光亚克力与 Fluent 风格层次'}
  ]);
  const IDS=new Set(BUILTINS.map(x=>x.id));
  const COLOR_MODES=new Set(['system','day','night']);
  const systemDark=typeof root.matchMedia==='function'?root.matchMedia('(prefers-color-scheme: dark)'):null;
  let appliedSettings=null;
  function normalizeSettings(input={}){const requested=String(input?.theme||input?.themeId||'default').trim().toLowerCase();const mode=String(input?.colorMode||(requested==='midnight'?'night':'system')).toLowerCase();return{theme:IDS.has(requested)?requested:'default',colorMode:COLOR_MODES.has(mode)?mode:'system',globalCssPresetId:typeof input?.globalCssPresetId==='string'?input.globalCssPresetId:null,globalCssEnabled:input?.globalCssEnabled!==false,updatedAt:input?.updatedAt||''};}
  function apply(input={}){
    const settings=normalizeSettings(input);
    appliedSettings=settings;
    if(typeof document!=='undefined'&&document.documentElement){
      const bypass=new URLSearchParams(typeof location==='undefined'?'':location.search).get('noCss')==='1'||root.MimaCssRecoveryBypass===true;
      const custom=!bypass&&settings.globalCssEnabled!==false&&!!settings.globalCssPresetId;
      // Reapplying a theme after CSS/Atelier notifications must not needlessly
      // invalidate the entire DOM's styles when the effective theme is unchanged.
      const element=document.documentElement;
      // The effective scheme is CSS-owned: never remount or rewrite a large theme when it changes.
      const effective=settings.colorMode==='system'?(systemDark?.matches?'night':'day'):settings.colorMode;
      if(element.getAttribute('data-mima-effective-mode')!==effective)element.setAttribute('data-mima-effective-mode',effective);
      // The original default theme has no separate dark preset. In automatic
      // mode, use the existing Midnight skin when the system is dark; for
      // custom CSS, retain its own art and switch only its day/night selectors.
      // Explicitly chosen built-in skins keep their original identities.
      const themeIdentity=custom||settings.theme==='default'
        ?(effective==='night'?'midnight':'default'):settings.theme;
      if(element.getAttribute('data-mima-selected-theme')!==themeIdentity)element.setAttribute('data-mima-selected-theme',themeIdentity);
      const nextTheme=custom?null:(settings.theme==='default'&&effective==='night'?'midnight':settings.theme==='default'?null:settings.theme);
      if(element.getAttribute('data-mima-theme')!==nextTheme){
        if(nextTheme===null)element.removeAttribute('data-mima-theme');
        else element.setAttribute('data-mima-theme',nextTheme);
      }
      // Native form controls and iOS browser chrome must reflect the same
      // effective mode as authored CSS. A chosen built-in skin remains intact.
      const scheme=effective==='night'?'dark':'light';
      if(element.style.colorScheme!==scheme)element.style.colorScheme=scheme;
      const meta=document.querySelector?.('meta[name="theme-color"]');if(meta){
        const dayColors={default:'#dfe1e4',midnight:'#e4e8ed',eink:'#c8c9c2',paper:'#e8dfcf','seoul-mist':'#f1f2f4','sakura-milk':'#fff0f5','lilac-cloud':'#f3effb','aqua-sky':'#eaf8fd','material-snow':'#f6f8fc','fluent-blue':'#eef5fe'};
        const nightColors={default:'#111216',midnight:'#111216',eink:'#1a1e1a',paper:'#201c19','seoul-mist':'#151a20','sakura-milk':'#20171d','lilac-cloud':'#191721','aqua-sky':'#121e25','material-snow':'#171b22','fluent-blue':'#151c26'};
        const chromeTheme=custom||settings.theme==='default'?themeIdentity:settings.theme;
        const nextColor=(effective==='night'?nightColors:dayColors)[chromeTheme]||(effective==='night'?nightColors.default:dayColors.default);
        if(meta.getAttribute('content')!==nextColor)meta.setAttribute('content',nextColor);
      }
    }
    return settings;
  }
  function getBuiltins(){return BUILTINS.map(x=>({...x}));}
  // Native system changes only affect automatic mode. The explicit preference stays untouched.
  const systemChanged=()=>{if(appliedSettings?.colorMode==='system')apply(appliedSettings);};
  if(systemDark?.addEventListener)systemDark.addEventListener('change',systemChanged);
  else if(systemDark?.addListener)systemDark.addListener(systemChanged);
  root.MimaThemeEngine={normalizeSettings,apply,getBuiltins};
})();
