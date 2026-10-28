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
  function normalizeSettings(input={}){const requested=String(input?.theme||input?.themeId||'default').trim().toLowerCase();return{theme:IDS.has(requested)?requested:'default',globalCssPresetId:typeof input?.globalCssPresetId==='string'?input.globalCssPresetId:null,globalCssEnabled:input?.globalCssEnabled!==false,updatedAt:input?.updatedAt||''};}
  function apply(input={}){
    const settings=normalizeSettings(input);
    if(typeof document!=='undefined'&&document.documentElement){
      const bypass=new URLSearchParams(typeof location==='undefined'?'':location.search).get('noCss')==='1'||root.MimaCssRecoveryBypass===true;
      const custom=!bypass&&settings.globalCssEnabled!==false&&!!settings.globalCssPresetId;
      if(custom||settings.theme==='default')document.documentElement.removeAttribute('data-mima-theme');else document.documentElement.setAttribute('data-mima-theme',settings.theme);
      document.documentElement.style.colorScheme=!custom&&settings.theme==='midnight'?'dark':'light';
      const meta=document.querySelector?.('meta[name="theme-color"]');if(meta){const colors={default:'#dfe1e4',midnight:'#111216',eink:'#c8c9c2',paper:'#e8dfcf','seoul-mist':'#f1f2f4','sakura-milk':'#fff0f5','lilac-cloud':'#f3effb','aqua-sky':'#eaf8fd','material-snow':'#f6f8fc','fluent-blue':'#eef5fe'};meta.setAttribute('content',colors[settings.theme]||colors.default);}
    }
    return settings;
  }
  function getBuiltins(){return BUILTINS.map(x=>({...x}));}
  root.MimaThemeEngine={normalizeSettings,apply,getBuiltins};
})();
